// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICollateralDebtPosition} from "./interfaces/ICollateralDebtPosition.sol";
import {ISeasonPool} from "./interfaces/ISeasonPool.sol";
import {MontaneParams} from "./helpers/MontaneParams.sol";

/// @notice Oracle-free season satellite on a cell. Opened on mint; maturity follows cell clock.
/// @dev Directional 1:1 buys in the first 12h after CDP open. Hedge packs until cell maturity.
contract SeasonPool is ISeasonPool, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SHARE_BPS = 10_000;
    uint256 public constant SLICE_BPS = 1_000; // 10%
    /// @dev Single-side mint window after the cell is opened.
    uint256 public constant DIRECTIONAL_WINDOW = 12 hours;

    IERC20 public immutable usdc;
    ICollateralDebtPosition public immutable cdp;
    address public immutable treasury;
    address public immutable manager;

    struct Market {
        uint256 cdpId;
        address issuer;
        uint256 openedAt; // CDP openedAt snapshot — directional clock
        uint256 maturity; // openedAt + MATURITY at open; gates also use maturityOf()
        uint256 verdantSupply;
        uint256 frostbiteSupply;
        uint256 verdantColl;
        uint256 frostbiteColl;
        bool resolved;
        bool verdantWins;
    }

    uint256 public nextMarketId = 1;
    mapping(uint256 => uint256) public marketOfCdp;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => uint256)) public verdantOf;
    mapping(uint256 => mapping(address => uint256)) public frostbiteOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event MarketOpened(uint256 indexed marketId, uint256 indexed cdpId, address issuer, uint256 maturity);
    event DirectionalMinted(uint256 indexed marketId, address indexed to, bool verdant, uint256 amount);
    event PackMinted(uint256 indexed marketId, address indexed to, uint256 each);
    event Resolved(uint256 indexed marketId, bool verdantWins, uint256 loserPot);
    event Claimed(uint256 indexed marketId, address indexed who, uint256 payout);
    event DustSwept(uint256 indexed marketId, uint256 amount);

    error BadCdp();
    error Exists();
    error Closed();
    error TooEarly();
    error WindowClosed();
    error NotResolved();
    error AlreadyClaimed();
    error Nothing();
    error OnlyManager();

    constructor(address usdc_, address cdp_, address treasury_, address manager_) {
        usdc = IERC20(usdc_);
        cdp = ICollateralDebtPosition(cdp_);
        treasury = treasury_;
        manager = manager_;
    }

    /// @dev Called by CDPManager on createCDP. Permissionless `openMarket` kept for legacy cells.
    function openForMint(uint256 cdpId) external returns (uint256 marketId) {
        if (msg.sender != manager) revert OnlyManager();
        return _open(cdpId);
    }

    function openMarket(uint256 cdpId) external nonReentrant returns (uint256 marketId) {
        return _open(cdpId);
    }

    /// @inheritdoc ISeasonPool
    function ensureSettled(uint256 cdpId) external {
        if (msg.sender != manager) revert OnlyManager();
        uint256 mid = marketOfCdp[cdpId];
        if (mid == 0) return;
        Market storage m = markets[mid];
        if (m.resolved) return;
        if (block.timestamp < maturityOf(mid)) revert TooEarly();
        _resolve(mid);
    }

    /// @notice Cell-aligned maturity: firstSaleAt if set, else openedAt — same clock as repay/hunt.
    function maturityOf(uint256 marketId) public view returns (uint256) {
        Market storage m = markets[marketId];
        if (m.cdpId == 0) return 0;
        ICollateralDebtPosition.CDP memory pos = cdp.getCDP(m.cdpId);
        uint256 start = pos.firstSaleAt == 0 ? m.openedAt : pos.firstSaleAt;
        return start + MontaneParams.MATURITY;
    }

    /// @notice Buy only VERDANT or only FROSTBITE at $1 USDC per token. First 12h after CDP open.
    function mintDirectional(uint256 marketId, bool verdant, uint256 amount) external nonReentrant {
        if (amount == 0) revert Nothing();
        Market storage m = markets[marketId];
        if (m.cdpId == 0 || m.resolved) revert Closed();
        if (block.timestamp >= maturityOf(marketId)) revert Closed();
        if (block.timestamp >= m.openedAt + DIRECTIONAL_WINDOW) revert WindowClosed();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (verdant) {
            m.verdantSupply += amount;
            m.verdantColl += amount;
            verdantOf[marketId][msg.sender] += amount;
        } else {
            m.frostbiteSupply += amount;
            m.frostbiteColl += amount;
            frostbiteOf[marketId][msg.sender] += amount;
        }
        emit DirectionalMinted(marketId, msg.sender, verdant, amount);
    }

    /// @notice Hedge pack: mint `each` VERDANT + `each` FROSTBITE for `2 * each` USDC until cell maturity.
    function mintPack(uint256 marketId, uint256 each) external nonReentrant {
        if (each == 0) revert Nothing();
        Market storage m = markets[marketId];
        if (m.cdpId == 0 || m.resolved || block.timestamp >= maturityOf(marketId)) revert Closed();

        uint256 pay = each * 2;
        usdc.safeTransferFrom(msg.sender, address(this), pay);

        m.verdantSupply += each;
        m.frostbiteSupply += each;
        m.verdantColl += each;
        m.frostbiteColl += each;
        verdantOf[marketId][msg.sender] += each;
        frostbiteOf[marketId][msg.sender] += each;

        emit PackMinted(marketId, msg.sender, each);
    }

    /// @notice After cell maturity: H > 1.10 → VERDANT; else FROSTBITE. Loser pot 10/10/80.
    /// @dev Uses `ratio` so resolve still works if the cell was closed early (legacy stuck path).
    function resolve(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        if (m.cdpId == 0 || m.resolved) revert Closed();
        if (block.timestamp < maturityOf(marketId)) revert TooEarly();
        _resolve(marketId);
    }

    function claim(uint256 marketId) external nonReentrant returns (uint256 payout) {
        Market storage m = markets[marketId];
        if (!m.resolved) revert NotResolved();
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        uint256 winBal = m.verdantWins ? verdantOf[marketId][msg.sender] : frostbiteOf[marketId][msg.sender];
        uint256 winSupply = m.verdantWins ? m.verdantSupply : m.frostbiteSupply;
        if (winBal == 0 || winSupply == 0) revert Nothing();

        claimed[marketId][msg.sender] = true;

        uint256 principalColl = m.verdantWins ? m.verdantColl : m.frostbiteColl;
        uint256 loserRemain = m.verdantWins ? m.frostbiteColl : m.verdantColl;

        payout = (principalColl * winBal) / winSupply;
        if (loserRemain > 0) {
            payout += (loserRemain * winBal) / winSupply;
        }

        verdantOf[marketId][msg.sender] = 0;
        frostbiteOf[marketId][msg.sender] = 0;

        if (payout > 0) usdc.safeTransfer(msg.sender, payout);
        emit Claimed(marketId, msg.sender, payout);
    }

    function previewClaim(uint256 marketId, address who) external view returns (uint256 payout) {
        Market storage m = markets[marketId];
        if (!m.resolved || claimed[marketId][who]) return 0;
        uint256 winBal = m.verdantWins ? verdantOf[marketId][who] : frostbiteOf[marketId][who];
        uint256 winSupply = m.verdantWins ? m.verdantSupply : m.frostbiteSupply;
        if (winBal == 0 || winSupply == 0) return 0;
        uint256 principalColl = m.verdantWins ? m.verdantColl : m.frostbiteColl;
        uint256 loserRemain = m.verdantWins ? m.frostbiteColl : m.verdantColl;
        payout = (principalColl * winBal) / winSupply;
        if (loserRemain > 0) payout += (loserRemain * winBal) / winSupply;
    }

    function directionalOpen(uint256 marketId) external view returns (bool) {
        Market storage m = markets[marketId];
        if (m.cdpId == 0 || m.resolved) return false;
        if (block.timestamp >= maturityOf(marketId)) return false;
        return block.timestamp < m.openedAt + DIRECTIONAL_WINDOW;
    }

    function _open(uint256 cdpId) internal returns (uint256 marketId) {
        ICollateralDebtPosition.CDP memory pos = cdp.getCDP(cdpId);
        if (!pos.active || pos.debtAmount == 0) revert BadCdp();
        if (marketOfCdp[cdpId] != 0) revert Exists();

        uint256 mat = pos.openedAt + MontaneParams.MATURITY;
        if (block.timestamp >= mat) revert Closed();

        marketId = nextMarketId++;
        marketOfCdp[cdpId] = marketId;
        markets[marketId] = Market({
            cdpId: cdpId,
            issuer: pos.issuer,
            openedAt: pos.openedAt,
            maturity: mat,
            verdantSupply: 0,
            frostbiteSupply: 0,
            verdantColl: 0,
            frostbiteColl: 0,
            resolved: false,
            verdantWins: false
        });
        emit MarketOpened(marketId, cdpId, pos.issuer, mat);
    }

    function _resolve(uint256 marketId) internal {
        Market storage m = markets[marketId];
        uint256 h = cdp.ratio(m.cdpId);
        bool verdantWins = h > MontaneParams.FROSTBITE;
        m.resolved = true;
        m.verdantWins = verdantWins;

        uint256 loserPot = verdantWins ? m.frostbiteColl : m.verdantColl;
        if (loserPot > 0) {
            uint256 toTreasury = (loserPot * SLICE_BPS) / SHARE_BPS;
            uint256 toIssuer = (loserPot * SLICE_BPS) / SHARE_BPS;
            if (toTreasury > 0) usdc.safeTransfer(treasury, toTreasury);
            if (toIssuer > 0) usdc.safeTransfer(m.issuer, toIssuer);
            if (verdantWins) m.frostbiteColl = loserPot - toTreasury - toIssuer;
            else m.verdantColl = loserPot - toTreasury - toIssuer;
        }

        // No winners → remainder cannot be claimed; sweep to treasury so USDC is not locked.
        uint256 winSupply = verdantWins ? m.verdantSupply : m.frostbiteSupply;
        if (winSupply == 0) {
            uint256 dust = m.verdantColl + m.frostbiteColl;
            m.verdantColl = 0;
            m.frostbiteColl = 0;
            if (dust > 0) {
                usdc.safeTransfer(treasury, dust);
                emit DustSwept(marketId, dust);
            }
        }

        emit Resolved(marketId, verdantWins, loserPot);
    }
}
