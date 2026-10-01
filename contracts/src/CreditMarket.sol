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

/// @dev Note CLOB. Long book trades real mMonad (seeded with the F long ask on mint).
///      Short book trades a cash-settled future on the same cell's note price; it starts empty.
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

    /// @dev Per-cell long-note price tape for the Season price rule. Only pre-maturity fills count.
    struct NoteTape {
        uint256 startTs;
        uint256 lastTs;
        uint256 lastPx;
        uint256 cumPxTime;
        uint256 fills;
        uint256 volume;
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
    /// @dev USDC locked behind a resting bid, or behind a resting short-book order of either side.
    mapping(uint256 => uint256) public bidEscrow;
    /// @dev Short book = cash-settled note-price future per cell. Each unit locks exactly 1 USDC in
    ///      `shortPot`: the short put in (PAR − e), the writer e. At settlement price v the short
    ///      claims (PAR − v) and the writer v, so the pot always covers both.
    mapping(address => mapping(uint256 => uint256)) public shortSize;
    mapping(address => mapping(uint256 => uint256)) public writerSize;
    mapping(uint256 => uint256) public shortPot;
    mapping(uint256 => uint256) public shortMark;
    mapping(uint256 => bool) public shortSettled;
    mapping(uint256 => NoteTape) public noteTape;

    /// @dev Global mMonad mark: every long fill sets `lastLongPx`, every short fill `lastShortPx`.
    ///      pMid = their midpoint, and cell health is marked against it.
    uint256 public lastLongPx = MontaneParams.PAR + MontaneParams.SPREAD;
    uint256 public lastShortPx = MontaneParams.PAR + MontaneParams.SPREAD - MontaneParams.LONG_SHORT_GAP;
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
    error NotMaker();
    error FomoOrder();
    error EnforcedPause();
    error BookFull();
    error InactiveCdp();
    error ShortClosed();
    error NotSettled();
    error TooEarly();
    error ShortCap();
    error SpreadTooTight();

    event Seeded(uint256 indexed cdpId, uint256 longAskId, uint256 face);
    event Filled(uint256 indexed orderId, address indexed taker, uint256 amount, uint256 payUsdc);
    event Sealed(uint256 pMid, uint256 blockNumber);
    event ShortTraded(
        uint256 indexed cdpId, address indexed short, address indexed writer, uint256 amount, uint256 price
    );
    event ShortNetted(uint256 indexed cdpId, address indexed who, uint256 amount);
    event ShortsSettled(uint256 indexed cdpId, uint256 mark, bool byPrice);
    event ShortClaimed(uint256 indexed cdpId, address indexed who, uint256 payout);
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

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function seedOnMint(address issuer, uint256 cdpId, uint256 face) external onlyCDPManager {
        require(token.balanceOf(address(this), cdpId) >= face, "escrow");
        uint256 px = MontaneParams.PAR + MontaneParams.SPREAD;
        uint256 floor = lastShortPx + MontaneParams.LONG_SHORT_GAP;
        if (px < floor) px = floor;
        uint256 longAsk = _push(issuer, cdpId, Side.LongAsk, px, face, false);
        seedLongAskId[cdpId] = longAsk;
        _seal();
        emit Seeded(cdpId, longAsk, face);
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
            _sendNote(maker, cdpId, left);
        }
    }

    function returnUnsoldTo(address issuer, uint256 cdpId) external onlyCDPManager returns (uint256 left) {
        uint256 id = seedLongAskId[cdpId];
        if (id != 0) {
            Order storage o = orders[id];
            left = o.remaining;
            _kill(id);
            seedLongAskId[cdpId] = 0;
            _sendNote(issuer, cdpId, left);
        }
    }

    /// @dev Called before the cell's G/F change on close, so the fallback mark sees the live cell.
    function settleShortsCdp(uint256 cdpId) external onlyCDPManager {
        _settleShorts(cdpId);
    }

    /// @notice Fix the short-book settlement price once the note-price window has ended.
    function settleShorts(uint256 cdpId) external {
        if (block.timestamp < _noteMaturity(cdpId)) revert TooEarly();
        _settleShorts(cdpId);
    }

    /// @notice Pay out `who`'s settled short and writer units on `cdpId`. Anyone may trigger it.
    function claimShort(uint256 cdpId, address who) external nonReentrant returns (uint256 out) {
        if (!shortSettled[cdpId]) revert NotSettled();
        out = _shortPayout(cdpId, who);
        shortSize[who][cdpId] = 0;
        writerSize[who][cdpId] = 0;
        shortPot[cdpId] -= out;
        _payOut(who, out);
        emit ShortClaimed(cdpId, who, out);
    }

    /// @inheritdoc ICreditMarket
    function shortClaim(uint256 cdpId, address who)
        external
        view
        returns (uint256 short, uint256 written, bool settled, uint256 mark, uint256 payout)
    {
        short = shortSize[who][cdpId];
        written = writerSize[who][cdpId];
        settled = shortSettled[cdpId];
        mark = shortMark[cdpId];
        if (settled) payout = _shortPayout(cdpId, who);
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
        // Market-wide FOMO orders have no cell; they fill through placeOrder on a specific cell.
        uint256 cell = orders[orderId].cdpId;
        if (cell == 0) revert BadOrder();
        _fill(orderId, amount, msg.sender, false, cell);
    }

    function placeOrder(uint256 cdpId, Side side, uint256 price, uint256 amount) external nonReentrant {
        if (paused()) revert EnforcedPause();
        if (frozen()) revert Frozen();
        require(price > 0 && amount > 0, "zero");
        require(cdpId != 0, "cell");
        _requireActiveCdp(cdpId);
        bool isShort = side == Side.ShortAsk || side == Side.ShortBid;
        if (isShort && price >= MontaneParams.PAR) revert BadOrder();
        if (!_inSpread(side, price)) revert SpreadTooTight();

        if (side == Side.LongAsk) {
            token.safeTransferFrom(msg.sender, address(this), cdpId, amount, "");
            uint256 left = _matchLongAsk(cdpId, price, amount, msg.sender);
            if (left > 0) _push(msg.sender, cdpId, side, price, left, false);
        } else if (side == Side.LongBid) {
            uint256 need = _payUsdc(amount, price);
            usdc.safeTransferFrom(msg.sender, address(this), need);
            (uint256 left, uint256 unused) = _matchLongBid(cdpId, price, amount, msg.sender, need);
            _restBid(cdpId, side, price, left, unused);
        } else {
            // Short book quotes the note price e: ShortAsk = go short at ≥ e, ShortBid = write at ≤ e.
            _requireShortOpen(cdpId);
            uint256 left = side == Side.ShortAsk
                ? _matchShortAsk(cdpId, price, amount, msg.sender)
                : _matchShortBid(cdpId, price, amount, msg.sender);
            if (left > 0) {
                uint256 writerLeg = (left * price) / MontaneParams.WAD;
                uint256 esc = side == Side.ShortBid ? writerLeg : left - writerLeg;
                usdc.safeTransferFrom(msg.sender, address(this), esc);
                uint256 id = _push(msg.sender, cdpId, side, price, left, false);
                bidEscrow[id] = esc;
            }
        }
        _seal();
    }

    /// @dev Resting remainder keeps its escrow; only the surplus goes back to the bidder.
    function _restBid(uint256 cdpId, Side side, uint256 price, uint256 left, uint256 unused) internal {
        uint256 keep;
        if (left > 0) {
            keep = _payUsdc(left, price);
            if (keep > unused) keep = unused;
            uint256 id = _push(msg.sender, cdpId, side, price, left, false);
            bidEscrow[id] = keep;
        }
        if (unused > keep) usdc.safeTransfer(msg.sender, unused - keep);
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
            _sendNote(msg.sender, o.cdpId, left);
        } else {
            uint256 escrow = bidEscrow[orderId];
            bidEscrow[orderId] = 0;
            if (escrow > 0) _pay(msg.sender, escrow);
        }

        emit OrderCancelled(orderId, msg.sender, left);
        _seal();
    }

    function fundFomo(uint256 usdcAmt) external {
        if (paused()) revert EnforcedPause();
        if (usdcAmt == 0) return;
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmt);
        fomoUsdc += usdcAmt;
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
            if (fomoUsdc > 0) {
                usdc.forceApprove(cdpManager, fomoUsdc);
                uint256 used = ICDPManager(cdpManager).injectWaterline(fomoUsdc);
                fomoUsdc -= used;
            }
        } else if (mode == 2 && fomoUsdc > 0) {
            // FOMO writes shorts; short-book prices stay below par and a full gap under the long print.
            uint256 px = sealedPMid > 0 ? sealedPMid : MontaneParams.PAR;
            if (px + MontaneParams.LONG_SHORT_GAP > lastLongPx) px = lastLongPx - MontaneParams.LONG_SHORT_GAP;
            if (px >= MontaneParams.PAR) px = MontaneParams.PAR - MontaneParams.SPREAD;
            uint256 amt = (fomoUsdc * MontaneParams.WAD) / px;
            if (amt > 0) {
                fomoBidId = _push(address(this), 0, Side.ShortBid, px, amt, true);
                bidEscrow[fomoBidId] = fomoUsdc;
                fomoUsdc = 0;
            }
        }
        _seal();
    }

    /// @notice Global mMonad price: midpoint of the last long-book and last short-book fills.
    function pMid() public view returns (uint256) {
        return (lastLongPx + lastShortPx) / 2;
    }

    /// @dev Long orders need price ≥ last short + gap; short orders need price ≤ last long − gap.
    function _inSpread(Side side, uint256 price) internal view returns (bool) {
        if (side == Side.LongAsk || side == Side.LongBid) {
            return price >= lastShortPx + MontaneParams.LONG_SHORT_GAP;
        }
        return price + MontaneParams.LONG_SHORT_GAP <= lastLongPx;
    }

    /// @dev USDC/USD from Pyth. Used as external peg for circuit / seal — not for cell accounting.
    /// @dev Book is USDC-settled; fair is usually ≈ PAR. Oracle is optional complexity for depeg checks.
    function pPyth() public view returns (uint256) {
        return _toWad(pyth.getPriceUnsafe(MontaneParams.USDC_USD_FEED_ID));
    }

    /// @dev No price circuit: the mark moves freely with trades. Only the guardian pause halts trading.
    function frozen() public pure returns (bool) {
        return false;
    }

    function returnBps() public view returns (int256) {
        uint256 base = p60 == 0 ? MontaneParams.PAR : p60;
        return (int256(pMid()) - int256(base)) * int256(MontaneParams.BPS) / int256(base);
    }

    function updateIssuanceCost() external {
        token.setIssuanceCost(pPyth());
    }

    /// @inheritdoc ICreditMarket
    function seasonMark(uint256 cdpId) public view returns (uint256 twap, uint256 fills, uint256 volume) {
        NoteTape storage t = noteTape[cdpId];
        fills = t.fills;
        volume = t.volume;
        if (fills == 0) return (0, 0, 0);
        uint256 mat = _noteMaturity(cdpId);
        uint256 end = block.timestamp < mat ? block.timestamp : mat;
        uint256 cum = t.cumPxTime;
        if (end > t.lastTs) cum += t.lastPx * (end - t.lastTs);
        twap = end > t.startTs ? cum / (end - t.startTs) : t.lastPx;
    }

    function _noteMaturity(uint256 cdpId) internal view returns (uint256) {
        ICollateralDebtPosition.CDP memory pos = cdp.getCDP(cdpId);
        uint256 start = pos.firstSaleAt == 0 ? pos.openedAt : pos.firstSaleAt;
        return start + MontaneParams.MATURITY;
    }

    /// @dev Fills under NOTE_MIN_FILL_BPS of the cell's face don't move the global mark.
    function _prints(uint256 cdpId, uint256 amount) internal view returns (bool) {
        return amount * MontaneParams.BPS >= cdp.getCDP(cdpId).debtAmount * MontaneParams.NOTE_MIN_FILL_BPS;
    }

    function _recordNote(uint256 cdpId, uint256 px, uint256 amount) internal {
        ICollateralDebtPosition.CDP memory pos = cdp.getCDP(cdpId);
        uint256 start = pos.firstSaleAt == 0 ? pos.openedAt : pos.firstSaleAt;
        if (block.timestamp >= start + MontaneParams.MATURITY) return;
        if (amount * MontaneParams.BPS < pos.debtAmount * MontaneParams.NOTE_MIN_FILL_BPS) return;
        NoteTape storage t = noteTape[cdpId];
        if (t.fills == 0) {
            t.startTs = block.timestamp;
            t.lastTs = block.timestamp;
            t.lastPx = MontaneParams.PAR;
        }
        t.cumPxTime += t.lastPx * (block.timestamp - t.lastTs);
        t.lastTs = block.timestamp;
        uint256 step = (t.lastPx * MontaneParams.NOTE_STEP_BPS) / MontaneParams.BPS;
        if (px > t.lastPx + step) px = t.lastPx + step;
        else if (px + step < t.lastPx) px = t.lastPx - step;
        t.lastPx = px;
        t.fills += 1;
        t.volume += amount;
    }

    /// @param cell The order's cell, or the taker's cell when filling a market-wide FOMO order.
    function _fill(uint256 orderId, uint256 amount, address taker, bool prepaid, uint256 cell) internal {
        Order storage o = orders[orderId];
        if (!o.active || amount == 0 || amount > o.remaining) revert BadOrder();
        if (taker == o.maker) revert SelfMatch();
        _requireActiveCdp(cell);
        if (!_inSpread(o.side, o.price)) revert SpreadTooTight();

        // Effects before transfers: ERC-1155 receivers get a callback.
        uint256 before = o.remaining;
        o.remaining = before - amount;
        if (o.remaining == 0) {
            o.active = false;
            _liveRemove(orderId);
        }

        uint256 payUsdc;
        if (o.side == Side.LongAsk || o.side == Side.LongBid) {
            payUsdc = _payUsdc(amount, o.price);
            uint256 fee = (payUsdc * MontaneParams.TAKER_BPS) / MontaneParams.BPS;
            if (o.side == Side.LongAsk) {
                if (!prepaid) usdc.safeTransferFrom(taker, address(this), payUsdc);
                _pay(treasury, fee);
                _pay(o.maker, payUsdc - fee);
                cdp.markFirstSale(cell, taker);
                _recordNote(cell, o.price, amount);
                _sendNote(taker, cell, amount);
            } else {
                require(bidEscrow[orderId] >= payUsdc, "escrow");
                bidEscrow[orderId] -= payUsdc;
                _pay(treasury, fee);
                _pay(taker, payUsdc - fee);
                cdp.markFirstSale(cell, o.maker);
                _recordNote(cell, o.price, amount);
                token.safeTransferFrom(prepaid ? address(this) : taker, o.maker, cell, amount, "");
            }
            if (_prints(cell, amount)) lastLongPx = o.price;
        } else {
            payUsdc = _fillShort(orderId, amount, before, taker, cell);
            if (_prints(cell, amount)) lastShortPx = o.price;
        }

        _recordVol(amount);
        _seal();
        emit Filled(orderId, taker, amount, payUsdc);
    }

    /// @dev Maker's leg is its pro-rata escrow (all of it on the last fill); taker tops each unit up to 1 USDC.
    function _fillShort(uint256 orderId, uint256 amount, uint256 before, address taker, uint256 cell)
        internal
        returns (uint256 takerLeg)
    {
        _requireShortOpen(cell);
        Order storage o = orders[orderId];
        uint256 esc = bidEscrow[orderId];
        uint256 makerLeg = o.remaining == 0 ? esc : (esc * amount) / before;
        bidEscrow[orderId] = esc - makerLeg;
        takerLeg = amount - makerLeg;
        uint256 fee = (takerLeg * MontaneParams.TAKER_BPS) / MontaneParams.BPS;
        usdc.safeTransferFrom(taker, address(this), takerLeg + fee);
        _pay(treasury, fee);
        shortPot[cell] += amount;
        (address short, address writer) = o.side == Side.ShortAsk ? (o.maker, taker) : (taker, o.maker);
        shortSize[short][cell] += amount;
        writerSize[writer][cell] += amount;
        emit ShortTraded(cell, short, writer, amount, o.price);
        _netShort(short, cell);
        _netShort(writer, cell);
        uint256 cap = (cdp.getCDP(cell).debtAmount * MontaneParams.SHORT_OI_BPS) / MontaneParams.BPS;
        if (shortPot[cell] > cap) revert ShortCap();
    }

    function _requireShortOpen(uint256 cdpId) internal view {
        if (shortSettled[cdpId] || block.timestamp >= _noteMaturity(cdpId)) revert ShortClosed();
    }

    /// @dev Holding both sides of the same cell nets out at 1 USDC per unit — the early exit.
    function _netShort(address who, uint256 cdpId) internal {
        uint256 s = shortSize[who][cdpId];
        uint256 w = writerSize[who][cdpId];
        uint256 n = s < w ? s : w;
        if (n == 0) return;
        shortSize[who][cdpId] = s - n;
        writerSize[who][cdpId] = w - n;
        shortPot[cdpId] -= n;
        _payOut(who, n);
        emit ShortNetted(cdpId, who, n);
    }

    /// @dev Mark = note TWAP (Season's thin-book rule), else redemption value; capped at par.
    function _settleShorts(uint256 cdpId) internal {
        if (shortSettled[cdpId]) return;
        (uint256 twap, uint256 fills, uint256 volume) = seasonMark(cdpId);
        ICollateralDebtPosition.CDP memory pos = cdp.getCDP(cdpId);
        bool byPrice = fills >= MontaneParams.SEASON_MIN_FILLS
            && volume * MontaneParams.BPS >= pos.debtAmount * MontaneParams.SEASON_MIN_VOL_BPS;
        uint256 mark;
        if (byPrice) mark = twap;
        else if (pos.debtAmount == 0) mark = MontaneParams.PAR;
        else mark = (pos.collateralAmount * MontaneParams.WAD) / pos.debtAmount;
        if (mark > MontaneParams.PAR) mark = MontaneParams.PAR;
        shortMark[cdpId] = mark;
        shortSettled[cdpId] = true;
        emit ShortsSettled(cdpId, mark, byPrice);
    }

    function _shortPayout(uint256 cdpId, address who) internal view returns (uint256) {
        uint256 mark = shortMark[cdpId];
        return (shortSize[who][cdpId] * (MontaneParams.PAR - mark) + writerSize[who][cdpId] * mark)
            / MontaneParams.WAD;
    }

    /// @dev The market itself is a writer via FOMO bids; its proceeds go back to the FOMO pool.
    function _payOut(address who, uint256 amount) internal {
        if (who == address(this)) fomoUsdc += amount;
        else _pay(who, amount);
    }

    /// @dev One scan + sort, then walk — same price-time priority as repeated `_bestAsk`/`_bestBid`.
    function _matchLongBid(uint256 cdpId, uint256 price, uint256 amount, address taker, uint256 prepaid)
        internal
        returns (uint256 left, uint256 unused)
    {
        (uint256[] memory ids, uint256 n) = _gatherAsks(Side.LongAsk, cdpId, price, taker);
        _sortAskIds(ids, n);
        return _walk(ids, n, amount, taker, cdpId, true, prepaid);
    }

    function _matchLongAsk(uint256 cdpId, uint256 price, uint256 amount, address taker)
        internal
        returns (uint256 left)
    {
        (uint256[] memory ids, uint256 n) = _gatherBids(Side.LongBid, cdpId, price, taker);
        _sortBidIds(ids, n);
        (left,) = _walk(ids, n, amount, taker, cdpId, true, type(uint256).max);
    }

    function _matchShortAsk(uint256 cdpId, uint256 price, uint256 amount, address taker)
        internal
        returns (uint256 left)
    {
        (uint256[] memory ids, uint256 n) = _gatherBids(Side.ShortBid, cdpId, price, taker);
        _sortBidIds(ids, n);
        (left,) = _walk(ids, n, amount, taker, cdpId, false, type(uint256).max);
    }

    function _matchShortBid(uint256 cdpId, uint256 price, uint256 amount, address taker)
        internal
        returns (uint256 left)
    {
        (uint256[] memory ids, uint256 n) = _gatherAsks(Side.ShortAsk, cdpId, price, taker);
        _sortAskIds(ids, n);
        (left,) = _walk(ids, n, amount, taker, cdpId, false, type(uint256).max);
    }

    /// @dev Fill sorted `ids` up to `left`. A finite `budget` caps USDC the taker prepaid (long bids).
    function _walk(
        uint256[] memory ids,
        uint256 n,
        uint256 left,
        address taker,
        uint256 cdpId,
        bool prepaid,
        uint256 budget
    ) private returns (uint256, uint256) {
        uint256 steps;
        for (uint256 i = 0; i < n && left > 0 && steps < MontaneParams.MATCH_FILL_MAX; i++) {
            Order storage o = orders[ids[i]];
            if (!o.active || o.remaining == 0) continue;
            uint256 take = o.remaining < left ? o.remaining : left;
            if (budget != type(uint256).max) {
                uint256 cost = _payUsdc(take, o.price);
                if (cost > budget) break;
                budget -= cost;
            }
            _fill(ids[i], take, taker, prepaid, cdpId);
            left -= take;
            unchecked {
                ++steps;
            }
        }
        return (left, budget);
    }

    /// @dev Eligible asks: same cell (FOMO is market-wide), price ≤ limit, not self. Price asc, id asc (FIFO).
    function _gatherAsks(Side side, uint256 cdpId, uint256 limit, address taker)
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
            if (o.cdpId != cdpId && !o.fomo) continue;
            if (o.price > limit || !_inSpread(side, o.price)) continue;
            ids[n] = id;
            unchecked {
                ++n;
            }
        }
    }

    /// @dev Eligible bids: same cell (FOMO is market-wide), price ≥ limit, not self. Price desc, id asc (FIFO).
    function _gatherBids(Side side, uint256 cdpId, uint256 limit, address taker)
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
            if (o.cdpId != cdpId && !o.fomo) continue;
            if (o.price < limit || !_inSpread(side, o.price)) continue;
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
        if (fomoBidId != 0) {
            uint256 escrow = bidEscrow[fomoBidId];
            bidEscrow[fomoBidId] = 0;
            fomoUsdc += escrow;
        }
        _kill(fomoBidId);
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
        uint256 spot = pMid();
        sealedPMid = spot;
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
            if (s == Side.LongAsk) {
                _sendNote(maker, cdpId, left);
            } else {
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

    function _sendNote(address to, uint256 cdpId, uint256 amount) internal {
        if (amount == 0) return;
        token.safeTransferFrom(address(this), to, cdpId, amount, "");
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
