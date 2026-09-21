// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IMontaneMonad} from "./interfaces/IMontaneMonad.sol";
import {ICollateralDebtPosition} from "./interfaces/ICollateralDebtPosition.sol";
import {ICreditMarket} from "./interfaces/ICreditMarket.sol";
import {ICDPManager} from "./interfaces/ICDPManager.sol";
import {ISeasonPool} from "./interfaces/ISeasonPool.sol";
import {MontaneParams} from "./helpers/MontaneParams.sol";

/// @dev Immutable core wiring. Guardian can pause; SeasonPool is set once after satellite deploy.
contract CDPManager is ICDPManager, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable treasury;
    IERC20 public immutable usdc;
    IMontaneMonad public immutable debtToken;
    ICollateralDebtPosition public immutable collateralDebtPosition;
    ICreditMarket public immutable creditMarket;
    ISeasonPool public seasonPool;

    bool public paused;

    mapping(address => uint256) public PositionCDPID;
    mapping(uint256 => address) public CDPPositionIssuer;
    mapping(address => uint256) public lastRepaidAt;

    struct HuntReq {
        address hunter;
        uint256 bond;
        bool pending;
    }

    mapping(uint256 => HuntReq) public huntRequest;

    error NotMature();
    error NotVerdant();
    error NotFrostbite();
    error HunterSelf();
    error Circuit();
    error MinRatio();
    error OnlyCreditMarket();
    error OnlyLongOwner();
    error Cap();
    error HuntExists();
    error NoHunt();
    error InstantHunt();
    error EnforcedPause();
    error ExpectedPause();
    error NotParty();
    error SeasonSet();

    event CDPCreated(address indexed issuer, uint256 indexed cdpId, uint256 collateral, uint256 debt);
    event Repaid(address indexed issuer, uint256 indexed cdpId);
    event Novated(uint256 indexed cdpId, address indexed hunter, address indexed priorLong, uint256 w, uint256 b);
    event WinterLevy(uint256 indexed cdpId, uint256 fee);
    event Waterline(uint256 indexed cdpId, uint256 added, uint256 newG);
    event Withdrawn(uint256 indexed cdpId, address indexed longOwner, uint256 amount);
    event HuntRequested(uint256 indexed cdpId, address indexed hunter, uint256 bond);
    event HuntSlashed(uint256 indexed cdpId, address indexed hunter, address indexed issuer, uint256 bond);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event EmergencyClosed(uint256 indexed cdpId, address indexed caller);
    event SeasonPoolSet(address indexed seasonPool);

    constructor(
        address _treasury,
        address _usdc,
        address _debtToken,
        address _cdp,
        address _market,
        address guardian
    ) Ownable(guardian) {
        treasury = _treasury;
        usdc = IERC20(_usdc);
        debtToken = IMontaneMonad(_debtToken);
        collateralDebtPosition = ICollateralDebtPosition(_cdp);
        creditMarket = ICreditMarket(_market);
    }

    modifier whenNotPaused() {
        if (paused) revert EnforcedPause();
        _;
    }

    modifier whenPaused() {
        if (!paused) revert ExpectedPause();
        _;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Wire Season satellite once (DeploySeason). Enables auto-open on mint + settle-on-close.
    function setSeasonPool(address pool) external onlyOwner {
        if (address(seasonPool) != address(0)) revert SeasonSet();
        seasonPool = ISeasonPool(pool);
        emit SeasonPoolSet(pool);
    }

    /// @notice Posts G in USDC, mints F to the book, seeds F long ASK + F short at spread s.
    function createCDP(uint256 debtAmount, uint256 usdcIn) public nonReentrant whenNotPaused returns (uint256 cdpId) {
        require(debtAmount > 0, "zero debt");
        if (creditMarket.frozen()) revert Circuit();

        uint256 fee = (debtAmount * originationBps(msg.sender)) / MontaneParams.BPS;
        require(usdcIn > fee, "fee");
        uint256 g = usdcIn - fee;

        uint256 h = (g * MontaneParams.WAD) / debtAmount;
        if (h < MontaneParams.FROSTBITE) revert MinRatio();

        usdc.safeTransferFrom(msg.sender, treasury, fee);
        usdc.safeTransferFrom(msg.sender, address(debtToken), g);

        cdpId = collateralDebtPosition.createCDP(msg.sender, g, debtAmount);
        debtToken.issue(address(creditMarket), msg.sender, debtAmount, g);
        creditMarket.seedOnMint(msg.sender, cdpId, debtAmount);

        if (address(seasonPool) != address(0)) {
            seasonPool.openForMint(cdpId);
        }

        PositionCDPID[msg.sender] = cdpId;
        CDPPositionIssuer[cdpId] = msg.sender;
        emit CDPCreated(msg.sender, cdpId, g, debtAmount);
    }

    function repayCDP(uint256 cdpId) external nonReentrant whenNotPaused {
        ICollateralDebtPosition.CDP memory pos = collateralDebtPosition.getCDP(cdpId);
        require(pos.active && msg.sender == pos.issuer, "issuer");
        _requireIssuerMature(pos.openedAt, pos.firstSaleAt, pos.openBlock);

        uint256 h = collateralDebtPosition.health(cdpId);
        if (h <= MontaneParams.FROSTBITE) revert NotVerdant();

        _closePosition(cdpId, pos);
        emit Repaid(pos.issuer, cdpId);
    }

    /// @notice While guardian-paused: issuer or long owner may unwind without maturity / verdant gates.
    function emergencyClose(uint256 cdpId) external nonReentrant whenPaused {
        ICollateralDebtPosition.CDP memory pos = collateralDebtPosition.getCDP(cdpId);
        require(pos.active, "cdp");
        if (msg.sender != pos.issuer && msg.sender != pos.longOwner) revert NotParty();

        _closePosition(cdpId, pos);
        emit EmergencyClosed(cdpId, msg.sender);
        emit Repaid(pos.issuer, cdpId);
    }

    /// @notice 25 bps on a fresh print. 1 bp if this address repaid within ROLL_WINDOW (48h).
    function originationBps(address issuer) public view returns (uint256) {
        uint256 repaidAt = lastRepaidAt[issuer];
        if (repaidAt != 0 && block.timestamp <= repaidAt + MontaneParams.ROLL_WINDOW) {
            return MontaneParams.ROLL_BPS;
        }
        return MontaneParams.ORIGINATION_BPS;
    }

    /// @notice Long owner after first sale + 24h. Cap = min(G, F * P_mid). δ above mark stays in the box.
    function withdraw(uint256 cdpId, uint256 amount) external nonReentrant whenNotPaused {
        ICollateralDebtPosition.CDP memory pos = collateralDebtPosition.getCDP(cdpId);
        require(pos.active, "cdp");
        if (msg.sender != pos.longOwner) revert OnlyLongOwner();
        require(pos.firstSaleAt != 0, "unsold");
        if (block.timestamp < pos.firstSaleAt + MontaneParams.MATURITY) revert NotMature();
        if (block.number < pos.openBlock + MontaneParams.MIN_BLOCKS) revert NotMature();

        uint256 mark = (pos.debtAmount * creditMarket.pMid()) / MontaneParams.WAD;
        uint256 cap = pos.collateralAmount < mark ? pos.collateralAmount : mark;
        if (amount == 0 || amount > cap) revert Cap();

        uint256 newG = pos.collateralAmount - amount;
        debtToken.withdrawCell(pos.issuer, msg.sender, amount);
        collateralDebtPosition.setCollateral(cdpId, newG);
        emit Withdrawn(cdpId, msg.sender, amount);
    }

    /// @notice Frostbite only. During maturity: lock B and wait. After maturity: novate now.
    function requestHunt(uint256 cdpId, uint256 p) external nonReentrant whenNotPaused {
        ICollateralDebtPosition.CDP memory pos = collateralDebtPosition.getCDP(cdpId);
        require(pos.active, "cdp");
        if (msg.sender == pos.issuer) revert HunterSelf();
        require(p > 0, "P");
        if (collateralDebtPosition.health(cdpId) > MontaneParams.FROSTBITE) revert NotFrostbite();

        if (_isMature(pos)) {
            _novate(cdpId, pos, msg.sender, p, false);
            return;
        }
        if (huntRequest[cdpId].pending) revert HuntExists();
        usdc.safeTransferFrom(msg.sender, address(this), p);
        huntRequest[cdpId] = HuntReq({hunter: msg.sender, bond: p, pending: true});
        emit HuntRequested(cdpId, msg.sender, p);
    }

    /// @notice First mature block: Verdant → bond to issuer; Frostbite → novation.
    function resolveHunt(uint256 cdpId) external nonReentrant whenNotPaused {
        ICollateralDebtPosition.CDP memory pos = collateralDebtPosition.getCDP(cdpId);
        require(pos.active, "cdp");
        HuntReq memory req = huntRequest[cdpId];
        if (!req.pending) revert NoHunt();
        if (!_isMature(pos)) revert NotMature();

        if (collateralDebtPosition.health(cdpId) > MontaneParams.FROSTBITE) {
            _slashHunt(cdpId, pos.issuer);
            return;
        }
        huntRequest[cdpId].pending = false;
        _novate(cdpId, pos, req.hunter, req.bond, true);
    }

    /// @notice Instant hunt only after maturity. During 24h use requestHunt.
    function liquidateCDP(uint256 cdpId, uint256 p) external nonReentrant whenNotPaused {
        ICollateralDebtPosition.CDP memory pos = collateralDebtPosition.getCDP(cdpId);
        require(pos.active, "cdp");
        if (msg.sender == pos.issuer) revert HunterSelf();
        require(p > 0, "P");
        if (!_isMature(pos)) revert InstantHunt();
        if (huntRequest[cdpId].pending) revert HuntExists();
        if (collateralDebtPosition.health(cdpId) > MontaneParams.FROSTBITE) revert NotFrostbite();
        _novate(cdpId, pos, msg.sender, p, false);
    }

    /// @dev Eligible 1.00 < H <= 1.10. Priority: H desc, need asc. Leftover USDC back to market.
    /// @dev Uses the waterline set (not all actives). Funds global top-`WATERLINE_BATCH` per call.
    function injectWaterline(uint256 usdcIn) external whenNotPaused returns (uint256 used) {
        if (msg.sender != address(creditMarket)) revert OnlyCreditMarket();
        if (usdcIn == 0) return 0;

        usdc.safeTransferFrom(msg.sender, address(debtToken), usdcIn);

        uint256 m = collateralDebtPosition.waterlineCount();
        if (m == 0) {
            debtToken.pullUsdc(msg.sender, usdcIn);
            return 0;
        }

        // Bound scan gas: do not walk an unbounded waterline set in one call.
        uint256 scan = m < MontaneParams.WATERLINE_SCAN_MAX ? m : MontaneParams.WATERLINE_SCAN_MAX;
        uint256 batch = scan < MontaneParams.WATERLINE_BATCH ? scan : MontaneParams.WATERLINE_BATCH;
        uint256[] memory ids = new uint256[](batch);
        uint256[] memory hs = new uint256[](batch);
        uint256[] memory needs = new uint256[](batch);
        uint256 filled;

        for (uint256 i = 0; i < scan; i++) {
            uint256 id = collateralDebtPosition.waterlineIdAt(i);
            ICollateralDebtPosition.CDP memory c = collateralDebtPosition.getCDP(id);
            uint256 h = (c.collateralAmount * MontaneParams.WAD) / c.debtAmount;
            uint256 target = ((MontaneParams.FROSTBITE + 1) * c.debtAmount + MontaneParams.WAD - 1)
                / MontaneParams.WAD;
            if (c.collateralAmount >= target) continue;
            uint256 need = target - c.collateralAmount;

            if (filled < batch) {
                ids[filled] = id;
                hs[filled] = h;
                needs[filled] = need;
                unchecked {
                    ++filled;
                }
            } else {
                uint256 worst = 0;
                for (uint256 j = 1; j < batch; j++) {
                    if (_better(hs[worst], needs[worst], hs[j], needs[j])) worst = j;
                }
                if (_better(h, need, hs[worst], needs[worst])) {
                    ids[worst] = id;
                    hs[worst] = h;
                    needs[worst] = need;
                }
            }
        }

        for (uint256 i = 1; i < filled; i++) {
            for (uint256 j = i; j > 0; j--) {
                if (!_better(hs[j], needs[j], hs[j - 1], needs[j - 1])) break;
                (ids[j - 1], ids[j]) = (ids[j], ids[j - 1]);
                (hs[j - 1], hs[j]) = (hs[j], hs[j - 1]);
                (needs[j - 1], needs[j]) = (needs[j], needs[j - 1]);
            }
        }

        uint256 left = usdcIn;
        for (uint256 i = 0; i < filled && left > 0; i++) {
            uint256 give = needs[i] < left ? needs[i] : left;
            ICollateralDebtPosition.CDP memory c = collateralDebtPosition.getCDP(ids[i]);
            debtToken.inject(c.issuer, give);
            uint256 newG = c.collateralAmount + give;
            collateralDebtPosition.setCollateral(ids[i], newG);
            emit Waterline(ids[i], give, newG);
            left -= give;
            used += give;
        }

        if (left > 0) debtToken.pullUsdc(msg.sender, left);
    }

    /// @dev Higher H first; equal H → smaller need first (same as prior insertion sort).
    function _better(uint256 hA, uint256 needA, uint256 hB, uint256 needB) private pure returns (bool) {
        return hA > hB || (hA == hB && needA < needB);
    }

    function healthOf(uint256 cdpId) external view returns (uint256) {
        return collateralDebtPosition.health(cdpId);
    }

    /// @return 1 ONLY_SELL, 2 ONLY_BUY, 0 none.
    function fomoMode() public view returns (uint8) {
        int256 rBps = creditMarket.returnBps();
        if (rBps <= -int256(MontaneParams.SHOCK_DOWN_BPS)) return 2;

        uint256 phi = frostbiteShare();
        if (rBps >= int256(MontaneParams.FOMO_UP_BPS) && phi > MontaneParams.FOMO_PHI) return 1;
        return 0;
    }

    function frostbiteShare() public view returns (uint256) {
        uint256 n = collateralDebtPosition.activeCount();
        if (n == 0) return 0;
        return (collateralDebtPosition.frostbiteCount() * MontaneParams.WAD) / n;
    }

    function _closePosition(uint256 cdpId, ICollateralDebtPosition.CDP memory pos) internal {
        // Season must settle first — blocks repay while market immature; auto-resolves when mature.
        if (address(seasonPool) != address(0)) {
            seasonPool.ensureSettled(cdpId);
        }

        if (huntRequest[cdpId].pending) {
            _slashHunt(cdpId, pos.issuer);
        }

        creditMarket.forceCoverCdp(cdpId);
        creditMarket.scrubCdp(cdpId);
        creditMarket.returnUnsoldTo(pos.issuer, cdpId);

        uint256 face = pos.debtAmount;
        uint256 g = pos.collateralAmount;
        // Mark-to-market of face at book mid. No floor on mark: `cap = min(G, mark)` already
        // bounds cell payout. A depressed mid underpays the long vs par; that is intentional.
        uint256 mark = (face * creditMarket.pMid()) / MontaneParams.WAD;
        uint256 cap = g < mark ? g : mark;

        address long = pos.longOwner;
        if (long != pos.issuer) {
            uint256 held = debtToken.balanceOf(long);
            if (held > face) held = face;
            if (held > 0) {
                uint256 pay = (cap * held) / face;
                debtToken.burnFrom(long, held);
                if (pay > 0) {
                    debtToken.withdrawCell(pos.issuer, long, pay);
                }
            }
        }

        collateralDebtPosition.repayCDP(cdpId);
        debtToken.repay(pos.issuer, face);
        lastRepaidAt[pos.issuer] = block.timestamp;
    }

    function _novate(
        uint256 cdpId,
        ICollateralDebtPosition.CDP memory pos,
        address hunter,
        uint256 p,
        bool bondPrepaid
    ) internal {
        uint256 h = collateralDebtPosition.health(cdpId);
        if (h <= MontaneParams.PAR) {
            uint256 fee = (p * MontaneParams.WINTER_BPS) / MontaneParams.BPS;
            if (fee > 0) {
                if (bondPrepaid) {
                    if (fee > p) fee = p;
                    usdc.safeTransfer(treasury, fee);
                    p -= fee;
                } else {
                    usdc.safeTransferFrom(hunter, treasury, fee);
                }
                emit WinterLevy(cdpId, fee);
            }
        }

        if (bondPrepaid) {
            usdc.safeTransfer(address(debtToken), p);
        } else {
            usdc.safeTransferFrom(hunter, address(debtToken), p);
        }

        uint256 w = pos.collateralAmount < p ? pos.collateralAmount : p;
        debtToken.novateCell(pos.issuer, pos.longOwner, w, p);
        collateralDebtPosition.setCollateral(cdpId, debtToken.underlyingCollateral(pos.issuer));
        collateralDebtPosition.liquidateCDP(hunter, cdpId);
        emit Novated(cdpId, hunter, pos.longOwner, w, p);
    }

    function _slashHunt(uint256 cdpId, address issuer) internal {
        HuntReq memory req = huntRequest[cdpId];
        huntRequest[cdpId].pending = false;
        if (req.bond > 0) usdc.safeTransfer(issuer, req.bond);
        emit HuntSlashed(cdpId, req.hunter, issuer, req.bond);
    }

    function _isMature(ICollateralDebtPosition.CDP memory pos) internal view returns (bool) {
        uint256 start = pos.firstSaleAt == 0 ? pos.openedAt : pos.firstSaleAt;
        return block.timestamp >= start + MontaneParams.MATURITY
            && block.number >= pos.openBlock + MontaneParams.MIN_BLOCKS;
    }

    /// @dev Clock is first sale when it exists, else mint.
    function _requireIssuerMature(uint256 openedAt, uint256 firstSaleAt, uint256 openBlock) internal view {
        uint256 start = firstSaleAt == 0 ? openedAt : firstSaleAt;
        if (block.timestamp < start + MontaneParams.MATURITY) revert NotMature();
        if (block.number < openBlock + MontaneParams.MIN_BLOCKS) revert NotMature();
    }
}
