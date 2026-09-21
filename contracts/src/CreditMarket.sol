// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IMontaneMonad} from "./interfaces/IMontaneMonad.sol";
import {ICollateralDebtPosition} from "./interfaces/ICollateralDebtPosition.sol";
import {ICreditMarket} from "./interfaces/ICreditMarket.sol";
import {ICDPManager} from "./interfaces/ICDPManager.sol";
import {MontaneParams} from "./helpers/MontaneParams.sol";

/// @dev Note CLOB. Seed on mint: F long ASK + F short quote, spread s, no self-match.
contract CreditMarket is ICreditMarket, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Side {
        LongAsk,
        LongBid,
        ShortAsk,
        ShortBid
    }

    struct Order {
        address maker;
        uint256 cdpId;
        Side side;
        uint256 price;
        uint256 remaining;
        bool active;
        bool fomo;
        uint256 landedAt;
    }

    struct LiveOrder {
        uint256 id;
        address maker;
        uint256 cdpId;
        Side side;
        uint256 price;
        uint256 remaining;
        bool fomo;
        uint256 landedAt;
    }

    address public immutable cdpManager;
    address public immutable treasury;
    IERC20 public immutable usdc;
    IMontaneMonad public immutable token;
    ICollateralDebtPosition public immutable cdp;
    IPyth public immutable pyth;

    uint256 public orderCount;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => uint256) public seedLongAskId;
    mapping(uint256 => uint256) public seedShortAskId;
    mapping(uint256 => uint256) public bidEscrow;
    mapping(address => mapping(uint256 => uint256)) public shortSize;
    mapping(address => mapping(uint256 => uint256)) public shortEscrow;
    mapping(uint256 => address[]) public shortHolders;
    mapping(uint256 => mapping(address => bool)) public shortListed;

    uint256 public sealedPMid = MontaneParams.PAR;
    uint256 public lastSealBlock;
    bool public circuitTripped;
    uint256 public tradeCount;
    uint256[100] public volRing;
    uint256 public v100;
    uint256 public p60 = MontaneParams.PAR;
    uint256 public p60Pending = MontaneParams.PAR;
    uint256 public pLagTs;
    uint256 public fomoUsdc;
    uint256 public fomoMmonad;
    uint256 public fomoAskId;
    uint256 public fomoBidId;

    /// @dev Live order ids per side (swap-and-pop). Match/book scans these, not `1..orderCount`.
    mapping(uint8 => uint256[]) private _live;
    mapping(uint256 => uint256) private _liveIndex; // 1-based into that side's list; 0 = absent
    /// @dev Best live bid price per side (LongBid / ShortBid). Maintained in _liveAdd/_liveRemove — O(1) mid.
    mapping(uint8 => uint256) private _topBidPx;

    error OnlyCDPManager();
    error SelfMatch();
    error Frozen();
    error BadOrder();
    error InvalidOraclePrice();
    error FomoSilent();
    error Cover();
    error NotMaker();
    error FomoOrder();
    error EnforcedPause();
    error BookFull();
    error InactiveCdp();
    error ShortBookFull();

    event Seeded(uint256 indexed cdpId, uint256 longAskId, uint256 shortAskId, uint256 face);
    event Filled(uint256 indexed orderId, address indexed taker, uint256 amount, uint256 payUsdc);
    event Sealed(uint256 pMid, uint256 blockNumber);
    event ShortOpened(address indexed who, uint256 indexed cdpId, uint256 amount, uint256 escrow);
    event ShortCovered(address indexed who, uint256 indexed cdpId, uint256 amount, uint256 refund);
    event OrderCancelled(uint256 indexed orderId, address indexed maker, uint256 remaining);

    constructor(
        address _pyth,
        address _treasury,
        address _usdc,
        address _manager,
        address _token,
        address _cdp
    ) {
        pyth = IPyth(_pyth);
        treasury = _treasury;
        usdc = IERC20(_usdc);
        cdpManager = _manager;
        token = IMontaneMonad(_token);
        cdp = ICollateralDebtPosition(_cdp);
    }

    modifier onlyCDPManager() {
        if (msg.sender != cdpManager) revert OnlyCDPManager();
        _;
    }

    function seedOnMint(address issuer, uint256 cdpId, uint256 face) external onlyCDPManager {
        require(token.balanceOf(address(this)) >= face, "escrow");
        uint256 longAsk = _push(issuer, cdpId, Side.LongAsk, MontaneParams.PAR + MontaneParams.SPREAD, face, false);
        uint256 shortAsk = _push(issuer, cdpId, Side.ShortAsk, MontaneParams.PAR - MontaneParams.SPREAD, face, false);
        seedLongAskId[cdpId] = longAsk;
        seedShortAskId[cdpId] = shortAsk;
        _seal();
        emit Seeded(cdpId, longAsk, shortAsk, face);
    }

    /// @dev Same as `returnUnsoldTo` for the seed maker — never leave mMonad stranded.
    function cancelSeed(uint256 cdpId) external onlyCDPManager {
        uint256 id = seedLongAskId[cdpId];
        if (id != 0) {
            Order storage o = orders[id];
            uint256 left = o.remaining;
            address maker = o.maker;
            _kill(id);
            seedLongAskId[cdpId] = 0;
            if (left > 0) require(token.transfer(maker, left), "seed return");
        }
        _kill(seedShortAskId[cdpId]);
        seedShortAskId[cdpId] = 0;
    }

    function returnUnsoldTo(address issuer, uint256 cdpId) external onlyCDPManager returns (uint256 left) {
        uint256 id = seedLongAskId[cdpId];
        if (id != 0) {
            Order storage o = orders[id];
            left = o.remaining;
            _kill(id);
            seedLongAskId[cdpId] = 0;
            if (left > 0) require(token.transfer(issuer, left), "return");
        }
        _kill(seedShortAskId[cdpId]);
        seedShortAskId[cdpId] = 0;
    }

    /// @dev Close every short on this cell; escrow goes back to the short, not the issuer.
    /// @dev `shortHolders` is capped at SHORT_HOLDERS_MAX — loop is bounded.
    function forceCoverCdp(uint256 cdpId) external onlyCDPManager {
        address[] storage list = shortHolders[cdpId];
        uint256 n = list.length;
        for (uint256 i = 0; i < n; i++) {
            address who = list[i];
            uint256 size = shortSize[who][cdpId];
            if (size == 0) {
                shortListed[cdpId][who] = false;
                continue;
            }
            uint256 escrow = shortEscrow[who][cdpId];
            shortSize[who][cdpId] = 0;
            shortEscrow[who][cdpId] = 0;
            shortListed[cdpId][who] = false;
            if (escrow > 0) _pay(who, escrow);
            emit ShortCovered(who, cdpId, size, escrow);
        }
        // Clear the list (bounded ≤ SHORT_HOLDERS_MAX).
        while (list.length > 0) {
            list.pop();
        }
    }

    /// @dev Cancel/refund all live orders for this cell. Bounded by LIVE_PER_SIDE_MAX × 4.
    function scrubCdp(uint256 cdpId) external onlyCDPManager {
        if (cdpId == 0) return;
        _scrubSide(Side.LongAsk, cdpId);
        _scrubSide(Side.LongBid, cdpId);
        _scrubSide(Side.ShortAsk, cdpId);
        _scrubSide(Side.ShortBid, cdpId);
    }

    function paused() public view returns (bool) {
        return ICDPManager(cdpManager).paused();
    }

    /// @dev Guardian pause or automatic circuit.
    function tradingHalted() public view returns (bool) {
        return paused() || frozen();
    }

    function fillOrder(uint256 orderId, uint256 amount) external nonReentrant {
        if (paused()) revert EnforcedPause();
        if (frozen() && !orders[orderId].fomo) revert Frozen();
        _fill(orderId, amount, msg.sender, false);
    }

    function placeOrder(uint256 cdpId, Side side, uint256 price, uint256 amount) external nonReentrant {
        if (paused()) revert EnforcedPause();
        if (frozen()) revert Frozen();
        require(price > 0 && amount > 0, "zero");
        _requireActiveCdp(cdpId);

        if (side == Side.LongAsk) {
            require(token.transferFrom(msg.sender, address(this), amount), "ask in");
            uint256 left = _matchLongAsk(cdpId, price, amount, msg.sender);
            if (left > 0) _push(msg.sender, cdpId, side, price, left, false);
            else if (amount > 0 && token.balanceOf(address(this)) > 0) {
                // leftover tokens already sent in match
            }
        } else if (side == Side.LongBid) {
            uint256 need = _payUsdc(amount, price);
            usdc.safeTransferFrom(msg.sender, address(this), need);
            (uint256 left, uint256 unused) = _matchLongBid(cdpId, price, amount, msg.sender, need);
            if (unused > 0) usdc.safeTransfer(msg.sender, unused);
            if (left > 0) {
                uint256 id = _push(msg.sender, cdpId, side, price, left, false);
                bidEscrow[id] = _payUsdc(left, price);
            }
        } else if (side == Side.ShortAsk) {
            uint256 left = _matchShortAsk(cdpId, price, amount, msg.sender);
            if (left > 0) _push(msg.sender, cdpId, side, price, left, false);
        } else {
            uint256 need = _payUsdc(amount, price);
            usdc.safeTransferFrom(msg.sender, address(this), need);
            (uint256 left, uint256 unused) = _matchShortBid(cdpId, price, amount, msg.sender, need);
            if (unused > 0) usdc.safeTransfer(msg.sender, unused);
            if (left > 0) {
                uint256 id = _push(msg.sender, cdpId, side, price, left, false);
                bidEscrow[id] = _payUsdc(left, price);
            }
        }
        _seal();
    }

    /// @notice Maker escape: pull remaining tokens / bid escrow. Allowed while paused.
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (!o.active || o.remaining == 0) revert BadOrder();
        if (o.maker != msg.sender) revert NotMaker();
        if (o.fomo) revert FomoOrder();

        uint256 left = o.remaining;
        _liveRemove(orderId);
        o.active = false;
        o.remaining = 0;

        if (o.side == Side.LongAsk) {
            require(token.transfer(msg.sender, left), "ask out");
        } else if (o.side == Side.LongBid || o.side == Side.ShortBid) {
            uint256 escrow = bidEscrow[orderId];
            bidEscrow[orderId] = 0;
            if (escrow > 0) _pay(msg.sender, escrow);
        }

        emit OrderCancelled(orderId, msg.sender, left);
        _seal();
    }

    function coverShort(uint256 cdpId, uint256 amount) external nonReentrant {
        uint256 size = shortSize[msg.sender][cdpId];
        if (amount == 0 || amount > size) revert Cover();
        require(token.transferFrom(msg.sender, address(this), amount), "cover in");
        uint256 escrow = shortEscrow[msg.sender][cdpId];
        uint256 refund = (escrow * amount) / size;
        uint256 left = size - amount;
        shortSize[msg.sender][cdpId] = left;
        shortEscrow[msg.sender][cdpId] = escrow - refund;
        if (left == 0) _unlistShort(msg.sender, cdpId);
        _pay(msg.sender, refund);
        emit ShortCovered(msg.sender, cdpId, amount, refund);
    }

    function fundFomo(uint256 usdcAmt, uint256 mmonadAmt) external {
        if (paused()) revert EnforcedPause();
        if (usdcAmt > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), usdcAmt);
            fomoUsdc += usdcAmt;
        }
        if (mmonadAmt > 0) {
            require(token.transferFrom(msg.sender, address(this), mmonadAmt), "fomo m");
            fomoMmonad += mmonadAmt;
        }
    }

    /// @notice Places FOMO maker orders and/or injects idle FOMO USDC waterline-first.
    function pokeFomo() external nonReentrant {
        if (paused()) revert EnforcedPause();
        uint8 mode = ICDPManager(cdpManager).fomoMode();
        uint256 phi = ICDPManager(cdpManager).frostbiteShare();

        if (mode == 0 || phi < MontaneParams.FOMO_STOP_PHI) {
            _killFomoOrders();
            revert FomoSilent();
        }

        if (mode == 1) {
            if (fomoMmonad > 0) {
                fomoAskId =
                    _push(address(this), 0, Side.LongAsk, MontaneParams.PAR + MontaneParams.SPREAD, fomoMmonad, true);
                fomoMmonad = 0;
            }
            if (fomoUsdc > 0) {
                usdc.forceApprove(cdpManager, fomoUsdc);
                uint256 used = ICDPManager(cdpManager).injectWaterline(fomoUsdc);
                fomoUsdc -= used;
            }
        } else if (mode == 2 && fomoUsdc > 0) {
            uint256 px = sealedPMid > 0 ? sealedPMid : MontaneParams.PAR;
            uint256 amt = (fomoUsdc * MontaneParams.WAD) / px;
            if (amt > 0) {
                fomoBidId = _push(address(this), 0, Side.ShortBid, px, amt, true);
                bidEscrow[fomoBidId] = fomoUsdc;
                fomoUsdc = 0;
            }
        }
        _seal();
    }

    function pMid() public view returns (uint256) {
        (uint256 mid, bool live) = _bookMid();
        if (live) return mid;
        return sealedPMid;
    }

    /// @dev USDC/USD from Pyth. Used as external peg for circuit / seal — not for cell accounting.
    /// @dev Book is USDC-settled; fair is usually ≈ PAR. Oracle is optional complexity for depeg checks.
    function pPyth() public view returns (uint256) {
        return _toWad(pyth.getPriceUnsafe(MontaneParams.USDC_USD_FEED_ID));
    }

    function frozen() public view returns (bool) {
        if (_thinVolume()) return true;
        (uint256 mid, bool live) = _bookMid();
        if (live) return _deviated(mid, pPyth());
        return circuitTripped;
    }

    function returnBps() public view returns (int256) {
        uint256 base = p60 == 0 ? MontaneParams.PAR : p60;
        return (int256(pMid()) - int256(base)) * int256(MontaneParams.BPS) / int256(base);
    }

    function updateIssuanceCost() external {
        token.setIssuanceCost(pPyth());
    }

    function _fill(uint256 orderId, uint256 amount, address taker, bool prepaid) internal {
        Order storage o = orders[orderId];
        if (!o.active || amount == 0 || amount > o.remaining) revert BadOrder();
        if (taker == o.maker) revert SelfMatch();
        if (o.cdpId != 0) _requireActiveCdp(o.cdpId);

        uint256 payUsdc = _payUsdc(amount, o.price);
        uint256 fee = (payUsdc * MontaneParams.TAKER_BPS) / MontaneParams.BPS;

        if (o.side == Side.LongAsk) {
            if (!prepaid) usdc.safeTransferFrom(taker, address(this), payUsdc);
            _pay(treasury, fee);
            if (o.fomo) {
                usdc.forceApprove(cdpManager, payUsdc - fee);
                uint256 used = ICDPManager(cdpManager).injectWaterline(payUsdc - fee);
                fomoUsdc += (payUsdc - fee) - used;
            } else {
                _pay(o.maker, payUsdc - fee);
            }
            require(token.transfer(taker, amount), "mMonad");
            if (o.cdpId != 0) cdp.markFirstSale(o.cdpId, taker);
        } else if (o.side == Side.LongBid) {
            require(bidEscrow[orderId] >= payUsdc, "escrow");
            bidEscrow[orderId] -= payUsdc;
            if (prepaid) require(token.transfer(o.maker, amount), "mMonad in");
            else require(token.transferFrom(taker, o.maker, amount), "mMonad in");
            _pay(treasury, fee);
            _pay(taker, payUsdc - fee);
            if (o.cdpId != 0) cdp.markFirstSale(o.cdpId, o.maker);
        } else if (o.side == Side.ShortAsk) {
            if (!prepaid) usdc.safeTransferFrom(taker, address(this), payUsdc);
            _pay(treasury, fee);
            shortEscrow[taker][o.cdpId] += payUsdc - fee;
            shortSize[taker][o.cdpId] += amount;
            _noteShort(taker, o.cdpId);
            emit ShortOpened(taker, o.cdpId, amount, payUsdc - fee);
        } else {
            require(bidEscrow[orderId] >= payUsdc, "escrow");
            bidEscrow[orderId] -= payUsdc;
            _pay(treasury, fee);
            _pay(taker, payUsdc - fee);
            shortSize[o.maker][o.cdpId] += amount;
            _noteShort(o.maker, o.cdpId);
            emit ShortOpened(o.maker, o.cdpId, amount, 0);
        }

        o.remaining -= amount;
        if (o.remaining == 0) {
            o.active = false;
            _liveRemove(orderId);
        }
        _recordVol(amount);
        _seal();
        emit Filled(orderId, taker, amount, payUsdc);
    }

    /// @dev One scan + sort, then walk — same price-time priority as repeated `_bestAsk`/`_bestBid`.
    function _matchLongBid(uint256, uint256 price, uint256 amount, address taker, uint256 prepaid)
        internal
        returns (uint256 left, uint256 unused)
    {
        left = amount;
        unused = prepaid;
        (uint256[] memory ids, uint256 n) = _gatherAsks(Side.LongAsk, price, taker);
        _sortAskIds(ids, n);
        uint256 steps;
        for (uint256 i = 0; i < n && left > 0 && steps < MontaneParams.MATCH_FILL_MAX; i++) {
            uint256 id = ids[i];
            Order storage o = orders[id];
            if (!o.active || o.remaining == 0) continue;
            uint256 take = o.remaining < left ? o.remaining : left;
            uint256 cost = _payUsdc(take, o.price);
            if (cost > unused) break;
            unused -= cost;
            _fill(id, take, taker, true);
            left -= take;
            unchecked {
                ++steps;
            }
        }
    }

    function _matchLongAsk(uint256, uint256 price, uint256 amount, address taker)
        internal
        returns (uint256 left)
    {
        left = amount;
        (uint256[] memory ids, uint256 n) = _gatherBids(Side.LongBid, price, taker);
        _sortBidIds(ids, n);
        uint256 steps;
        for (uint256 i = 0; i < n && left > 0 && steps < MontaneParams.MATCH_FILL_MAX; i++) {
            uint256 id = ids[i];
            Order storage o = orders[id];
            if (!o.active || o.remaining == 0) continue;
            uint256 take = o.remaining < left ? o.remaining : left;
            _fill(id, take, taker, true);
            left -= take;
            unchecked {
                ++steps;
            }
        }
    }

    function _matchShortAsk(uint256, uint256 price, uint256 amount, address taker)
        internal
        returns (uint256 left)
    {
        left = amount;
        (uint256[] memory ids, uint256 n) = _gatherBids(Side.ShortBid, price, taker);
        _sortBidIds(ids, n);
        uint256 steps;
        for (uint256 i = 0; i < n && left > 0 && steps < MontaneParams.MATCH_FILL_MAX; i++) {
            uint256 id = ids[i];
            Order storage o = orders[id];
            if (!o.active || o.remaining == 0) continue;
            uint256 take = o.remaining < left ? o.remaining : left;
            _fill(id, take, taker, true);
            left -= take;
            unchecked {
                ++steps;
            }
        }
    }

    function _matchShortBid(uint256, uint256 price, uint256 amount, address taker, uint256 prepaid)
        internal
        returns (uint256 left, uint256 unused)
    {
        left = amount;
        unused = prepaid;
        (uint256[] memory ids, uint256 n) = _gatherAsks(Side.ShortAsk, price, taker);
        _sortAskIds(ids, n);
        uint256 steps;
        for (uint256 i = 0; i < n && left > 0 && steps < MontaneParams.MATCH_FILL_MAX; i++) {
            uint256 id = ids[i];
            Order storage o = orders[id];
            if (!o.active || o.remaining == 0) continue;
            uint256 take = o.remaining < left ? o.remaining : left;
            uint256 cost = _payUsdc(take, o.price);
            if (cost > unused) break;
            unused -= cost;
            _fill(id, take, taker, true);
            left -= take;
            unchecked {
                ++steps;
            }
        }
    }

    /// @dev Eligible asks: price ≤ limit, not self. Order by price asc, id asc (FIFO).
    function _gatherAsks(Side side, uint256 limit, address taker)
        private
        view
        returns (uint256[] memory ids, uint256 n)
    {
        uint256[] storage list = _live[uint8(side)];
        uint256 len = list.length;
        ids = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 id = list[i];
            Order storage o = orders[id];
            if (!o.active || o.remaining == 0 || o.maker == taker) continue;
            if (o.price > limit) continue;
            ids[n] = id;
            unchecked {
                ++n;
            }
        }
    }

    /// @dev Eligible bids: price ≥ limit, not self. Order by price desc, id asc (FIFO).
    function _gatherBids(Side side, uint256 limit, address taker)
        private
        view
        returns (uint256[] memory ids, uint256 n)
    {
        uint256[] storage list = _live[uint8(side)];
        uint256 len = list.length;
        ids = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 id = list[i];
            Order storage o = orders[id];
            if (!o.active || o.remaining == 0 || o.maker == taker) continue;
            if (o.price < limit) continue;
            ids[n] = id;
            unchecked {
                ++n;
            }
        }
    }

    function _sortAskIds(uint256[] memory ids, uint256 n) private view {
        // Insertion sort — n ≤ LIVE_PER_SIDE_MAX.
        for (uint256 i = 1; i < n; i++) {
            uint256 id = ids[i];
            uint256 px = orders[id].price;
            uint256 j = i;
            while (j > 0) {
                uint256 prev = ids[j - 1];
                uint256 prevPx = orders[prev].price;
                if (prevPx < px || (prevPx == px && prev < id)) break;
                ids[j] = prev;
                unchecked {
                    --j;
                }
            }
            ids[j] = id;
        }
    }

    function _sortBidIds(uint256[] memory ids, uint256 n) private view {
        for (uint256 i = 1; i < n; i++) {
            uint256 id = ids[i];
            uint256 px = orders[id].price;
            uint256 j = i;
            while (j > 0) {
                uint256 prev = ids[j - 1];
                uint256 prevPx = orders[prev].price;
                // Better bid first: higher price, then lower id.
                if (prevPx > px || (prevPx == px && prev < id)) break;
                ids[j] = prev;
                unchecked {
                    --j;
                }
            }
            ids[j] = id;
        }
    }

    function _bookMid() internal view returns (uint256 mid, bool live) {
        uint256 lb = _topBidPx[uint8(Side.LongBid)];
        uint256 sb = _topBidPx[uint8(Side.ShortBid)];
        if (lb == 0 || sb == 0) return (0, false);
        return ((lb + sb) / 2, true);
    }

    function _thinVolume() internal view returns (bool) {
        return tradeCount >= MontaneParams.V100_WINDOW && v100 < MontaneParams.V100_MIN;
    }

    function _deviated(uint256 mid, uint256 fair) internal pure returns (bool) {
        if (fair == 0) return true;
        uint256 diff = mid > fair ? mid - fair : fair - mid;
        return diff * MontaneParams.BPS / fair >= MontaneParams.CIRCUIT_BPS;
    }

    function _push(address maker, uint256 cdpId, Side side, uint256 price, uint256 amount, bool fomo)
        internal
        returns (uint256 id)
    {
        id = ++orderCount;
        orders[id] = Order(maker, cdpId, side, price, amount, true, fomo, block.timestamp);
        _liveAdd(side, id);
    }

    /// @dev Bounded by `LIVE_PER_SIDE_MAX` per side (see `_liveAdd`). Skips inactive holes.
    function liveBook() external view returns (LiveOrder[] memory rows) {
        uint256 n = _live[0].length + _live[1].length + _live[2].length + _live[3].length;
        uint256 cap = 4 * MontaneParams.LIVE_PER_SIDE_MAX;
        if (n > cap) n = cap;
        rows = new LiveOrder[](n);
        uint256 j;
        for (uint8 s = 0; s < 4 && j < n; s++) {
            uint256[] storage list = _live[s];
            uint256 len = list.length;
            for (uint256 i = 0; i < len && j < n; i++) {
                uint256 id = list[i];
                Order storage o = orders[id];
                if (!o.active || o.remaining == 0) continue;
                rows[j++] = LiveOrder({
                    id: id,
                    maker: o.maker,
                    cdpId: o.cdpId,
                    side: o.side,
                    price: o.price,
                    remaining: o.remaining,
                    fomo: o.fomo,
                    landedAt: o.landedAt
                });
            }
        }
        assembly {
            mstore(rows, j)
        }
    }

    function liveCount(uint8 side) external view returns (uint256) {
        return _live[side].length;
    }

    function _kill(uint256 id) internal {
        if (id == 0) return;
        _liveRemove(id);
        orders[id].active = false;
        orders[id].remaining = 0;
    }

    function _liveAdd(Side side, uint256 id) private {
        uint256[] storage list = _live[uint8(side)];
        if (list.length >= MontaneParams.LIVE_PER_SIDE_MAX) revert BookFull();
        list.push(id);
        _liveIndex[id] = list.length;
        if (side == Side.LongBid || side == Side.ShortBid) {
            uint256 px = orders[id].price;
            uint8 s = uint8(side);
            if (px > _topBidPx[s]) _topBidPx[s] = px;
        }
    }

    function _liveRemove(uint256 id) private {
        uint256 idx = _liveIndex[id];
        if (idx == 0) return;
        Side side = orders[id].side;
        uint256 px = orders[id].price;
        uint8 s = uint8(side);
        uint256[] storage list = _live[s];
        uint256 lastIdx = list.length;
        uint256 lastId = list[lastIdx - 1];
        if (idx != lastIdx) {
            list[idx - 1] = lastId;
            _liveIndex[lastId] = idx;
        }
        list.pop();
        _liveIndex[id] = 0;
        // Only rescan when the removed order was (tied for) the top bid.
        if ((side == Side.LongBid || side == Side.ShortBid) && px == _topBidPx[s]) {
            _recomputeTopBid(side);
        }
    }

    function _recomputeTopBid(Side side) private {
        uint256 best;
        uint256[] storage list = _live[uint8(side)];
        uint256 n = list.length;
        for (uint256 i = 0; i < n; i++) {
            Order storage o = orders[list[i]];
            if (!o.active || o.remaining == 0) continue;
            if (o.price > best) best = o.price;
        }
        _topBidPx[uint8(side)] = best;
    }

    function _killFomoOrders() internal {
        _kill(fomoAskId);
        if (fomoBidId != 0) {
            uint256 escrow = bidEscrow[fomoBidId];
            bidEscrow[fomoBidId] = 0;
            fomoUsdc += escrow;
        }
        _kill(fomoBidId);
        fomoAskId = 0;
        fomoBidId = 0;
    }

    function _recordVol(uint256 amount) internal {
        uint256 slot = tradeCount % MontaneParams.V100_WINDOW;
        if (tradeCount >= MontaneParams.V100_WINDOW) {
            v100 -= volRing[slot];
        }
        volRing[slot] = amount;
        v100 += amount;
        tradeCount += 1;
    }

    function _seal() internal {
        if (lastSealBlock == block.number) return;
        lastSealBlock = block.number;
        uint256 pythP = pPyth();
        (uint256 mid, bool live) = _bookMid();
        if (_thinVolume() || (live && _deviated(mid, pythP))) {
            sealedPMid = pythP;
            circuitTripped = true;
        } else if (live) {
            sealedPMid = mid;
            circuitTripped = false;
        }
        uint256 spot = live ? mid : sealedPMid;
        if (pLagTs == 0) {
            p60 = spot;
            p60Pending = spot;
            pLagTs = block.timestamp;
        } else if (block.timestamp >= pLagTs + MontaneParams.FOMO_WINDOW) {
            p60 = p60Pending;
            p60Pending = spot;
            pLagTs = block.timestamp;
        }
        emit Sealed(sealedPMid, block.number);
    }

    function _noteShort(address who, uint256 cdpId) internal {
        if (cdpId == 0 || shortListed[cdpId][who]) return;
        address[] storage list = shortHolders[cdpId];
        if (list.length >= MontaneParams.SHORT_HOLDERS_MAX) revert ShortBookFull();
        shortListed[cdpId][who] = true;
        list.push(who);
    }

    /// @dev Swap-and-pop when short size hits zero so `forceCoverCdp` stays small.
    function _unlistShort(address who, uint256 cdpId) internal {
        if (!shortListed[cdpId][who]) return;
        shortListed[cdpId][who] = false;
        address[] storage list = shortHolders[cdpId];
        uint256 n = list.length;
        for (uint256 i = 0; i < n; i++) {
            if (list[i] != who) continue;
            list[i] = list[n - 1];
            list.pop();
            break;
        }
    }

    function _requireActiveCdp(uint256 cdpId) internal view {
        if (cdpId == 0) return;
        ICollateralDebtPosition.CDP memory pos = cdp.getCDP(cdpId);
        if (!pos.active) revert InactiveCdp();
    }

    /// @dev Walk live list from the end; each cancel mutates length — restart after remove.
    function _scrubSide(Side side, uint256 cdpId) private {
        uint256[] storage list = _live[uint8(side)];
        uint256 i = list.length;
        while (i > 0) {
            unchecked {
                --i;
            }
            uint256 id = list[i];
            Order storage o = orders[id];
            if (o.cdpId != cdpId || !o.active || o.fomo) continue;
            uint256 left = o.remaining;
            address maker = o.maker;
            Side s = o.side;
            _liveRemove(id);
            o.active = false;
            o.remaining = 0;
            if (s == Side.LongAsk && left > 0) {
                require(token.transfer(maker, left), "scrub ask");
            } else if (s == Side.LongBid || s == Side.ShortBid) {
                uint256 escrow = bidEscrow[id];
                bidEscrow[id] = 0;
                if (escrow > 0) _pay(maker, escrow);
            }
            emit OrderCancelled(id, maker, left);
            i = list.length;
        }
    }

    function _payUsdc(uint256 amount, uint256 price) internal view returns (uint256) {
        uint256 cost = token.getIssuanceCost();
        return (amount * price) / cost;
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        usdc.safeTransfer(to, amount);
    }

    function _toWad(PythStructs.Price memory price) internal pure returns (uint256) {
        if (price.price <= 0) revert InvalidOraclePrice();
        uint256 absPrice = uint256(uint64(price.price));
        int256 decimals = int256(price.expo) + 18;
        if (decimals >= 0) {
            return absPrice * (10 ** uint256(decimals));
        }
        return absPrice / (10 ** uint256(-decimals));
    }
}
