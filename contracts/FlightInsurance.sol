// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Trustus} from "./Trustus.sol";
import {LPWallet} from "./LPWallet.sol";

import {IFlightStatusOracle} from "./interfaces/IFlightStatusOracle.sol";
import {ITokensRepository} from "./interfaces/ITokensRepository.sol";
import {IMarket} from "./interfaces/IMarket.sol";
import {IProduct} from "./interfaces/IProduct.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";
import {RegistryMixinUpgradeable} from "./utils/RegistryMixin.sol";
import {FlightDelayMarketFactory} from "./FlightDelayMarketFactory.sol";
import {FlightDelayMarket} from "./FlightDelayMarket.sol";

contract FlightInsurance is
    IProduct,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    Trustus,
    RegistryMixinUpgradeable,
    UUPSUpgradeable
{
    event FlightDelayMarketCreated(
        bytes32 indexed marketId,
        uint256 indexed uniqueId,
        address indexed creator
    );

    event FlightDelayMarketSponsored(
        bytes32 indexed marketId,
        address indexed participant,
        uint256 value,
        bool betYes
    );

    event FlightDelayMarketLiquidityProvided(
        bytes32 indexed marketId,
        address indexed provider,
        uint256 value
    );

    event FlightDelayMarketParticipated(
        bytes32 indexed marketId,
        address indexed participant,
        uint256 value,
        bool betYes,
        uint256 amount,
        bool sponsored
    );

    event FlightDelayMarketWithdrawn(
        bytes32 indexed marketId,
        address indexed participant,
        uint256 amount,
        bool betYes,
        uint256 value
    );

    event FlightDelayMarketSettled(bytes32 indexed marketId, bool yesWin, bytes outcome);

    event FlightDelayMarketClaimed(
        bytes32 indexed marketId,
        address indexed participant,
        uint256 value
    );

    error ZeroAddress();

    bytes32 private constant TRUSTUS_REQUEST_MARKET =
        0x416d5838653a925e2c4ccf0b43e376ad31434b2095ec358fe6b0519c1e2f2bbe;

    /// @dev Stores the next value to use
    uint256 private _marketUniqueIdCounter;

    /// @notice Markets storage
    mapping(bytes32 => FlightDelayMarket) private _markets;

    /// @notice Holds LP funds
    LPWallet private _lpWallet;

    /// @dev Sponsored bet amount
    uint256 private _sponsoredBetAmount;

    /// @notice Stores the participant -> market mapping. Only one market & prediction per participant is allowed.
    mapping(address => address) private _sponsoredParticipants;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IRegistry registry_) public initializer {
        __RegistryMixin_init(registry_);
        __Ownable_init();
        __ReentrancyGuard_init();
        __Trustus_init();
        __UUPSUpgradeable_init();

        _marketUniqueIdCounter = 10;
        _sponsoredBetAmount = 0.01 ether;
    }

    function getMarket(bytes32 marketId) external view override returns (address) {
        return address(_markets[marketId]);
    }

    function findMarket(
        string calldata flightName,
        uint64 departureDate,
        uint32 delay
    ) external view returns (bytes32, FlightDelayMarket) {
        FlightDelayMarketFactory factory = FlightDelayMarketFactory(_registry.getAddress(1));
        bytes32 marketId = factory.getMarketId(flightName, departureDate, delay);
        return (marketId, _markets[marketId]);
    }

    // slither-disable-next-line reentrancy-eth reentrancy-no-eth
    function createMarket(
        bool betYes,
        TrustusPacket calldata packet
    ) external payable nonReentrant verifyPacket(TRUSTUS_REQUEST_MARKET, packet) {
        _createMarket(betYes, packet, msg.value, false);
    }

    /**
     * Sponsored call to create a market, the value is not allowed to be sent.
     * The call is only available when sponsoreAvailable is true.
     * @param betYes - bet on yes or no
     * @param packet - Trustus packet, containing the market configuration - will be verified
     */
    // slither-disable-next-line reentrancy-eth reentrancy-no-eth
    function createMarketSponsored(
        bool betYes,
        TrustusPacket calldata packet
    ) external nonReentrant verifyPacket(TRUSTUS_REQUEST_MARKET, packet) {
        _beforeSponsoredCall(_msgSender());
        _createMarket(betYes, packet, _sponsoredBetAmount, true);
    }

    /**
     * Sponsored call to participate in a market, the value is not allowed to be sent.
     * Each participant can only participate once in any market. The call is only available when sponsoreAvailable is true.
     * @param marketAddress - market address
     * @param betYes - bet on yes or no
     */
    function registerParticipantSponsored(
        address marketAddress,
        bool betYes
    ) external nonReentrant {
        _beforeSponsoredCall(_msgSender());

        FlightDelayMarket market = FlightDelayMarket(marketAddress);
        require(address(market) != address(0), "Invalid market");

        _sponsoredParticipants[_msgSender()] = address(market);
        market.registerParticipant{value: _sponsoredBetAmount}(_msgSender(), betYes, true);

        emit FlightDelayMarketSponsored(
            market.marketId(),
            _msgSender(),
            _sponsoredBetAmount,
            betYes
        );
    }

    /// @notice Sets the trusted signer of Trustus package
    function setIsTrusted(address account_, bool trusted_) external onlyOwner {
        if (account_ == address(0)) {
            revert ZeroAddress();
        }

        _setIsTrusted(account_, trusted_);
    }

    function setWallet(LPWallet lpWallet_) external onlyOwner {
        _lpWallet = lpWallet_;
    }

    function setSponsoredBetAmount(uint256 amount_) external onlyOwner {
        _sponsoredBetAmount = amount_;
    }

    function sponsoredBetAmount() external view returns (uint256) {
        return _sponsoredBetAmount;
    }

    function participant(address account) external view returns (address) {
        return _sponsoredParticipants[account];
    }

    function wallet() external view returns (address) {
        return address(_lpWallet);
    }

    /**
     * Returns true if sponsored calls are available.
     * @param account - account to check if it is already participating, pass address(0) if no account check is needed
     */
    function sponsorAvailable(address account) external view returns (bool) {
        bool isAvailable = _sponsoredBetAmount > 0 &&
            (address(this).balance >= _sponsoredBetAmount);
        if (account == address(0)) {
            return isAvailable;
        } else {
            return isAvailable && (_sponsoredParticipants[account] == address(0));
        }
    }

    /**
     * Insurance contract holds funds to sponsor the market creation and first prediction. Only exteranally provided funds are held.
     * This function allows to withdraw the funds to address specified.
     * @param to - address to withdraw funds to
     */
    function withdraw(address to) external onlyOwner {
        (bool sent, ) = payable(to).call{value: address(this).balance}("");
        require(sent, "Can't withdraw");
    }

    // hooks
    function onMarketLiquidity(
        bytes32 marketId,
        address provider,
        uint256 value
    ) external override {
        require(msg.sender == address(_markets[marketId]), "Invalid market");
        emit FlightDelayMarketLiquidityProvided(marketId, provider, value);
    }

    /**
     * Deprecated hook, use onMarketParticipateV2 instead
     * @dev This hook is only used for the old markets, which are not created by the recent factory. It will be removed in the future.
     */
    function onMarketParticipate(
        bytes32 marketId,
        address account,
        uint256 value,
        bool betYes,
        uint256 amount
    ) external {
        require(msg.sender == address(_markets[marketId]), "Invalid market");
        emit FlightDelayMarketParticipated(marketId, account, value, betYes, amount, false);
    }

    function onMarketParticipateV2(
        bytes32 marketId,
        address account,
        uint256 value,
        bool betYes,
        uint256 amount,
        bool sponsored
    ) external override {
        require(msg.sender == address(_markets[marketId]), "Invalid market");
        emit FlightDelayMarketParticipated(marketId, account, value, betYes, amount, sponsored);
    }

    function onMarketWithdraw(
        bytes32 marketId,
        address account,
        uint256 amount,
        bool betYes,
        uint256 value
    ) external override {
        require(msg.sender == address(_markets[marketId]), "Invalid market");
        emit FlightDelayMarketWithdrawn(marketId, account, amount, betYes, value);
    }

    function onMarketSettle(
        bytes32 marketId,
        bool yesWin,
        bytes calldata outcome
    ) external override {
        require(msg.sender == address(_markets[marketId]), "Invalid market");
        emit FlightDelayMarketSettled(marketId, yesWin, outcome);
    }

    function onMarketClaim(bytes32 marketId, address account, uint256 value) external override {
        require(msg.sender == address(_markets[marketId]), "Invalid market");
        emit FlightDelayMarketClaimed(marketId, account, value);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @dev As we didn't initially inherit from ERC2771Upgradeable, we will provide the functionality manually
    // import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
    function isTrustedForwarder(address forwarder) public view virtual returns (bool) {
        return forwarder == _registry.getAddress(101);
    }

    function _beforeSponsoredCall(address account) internal view {
        require(_sponsoredBetAmount > 0, "FlightDelayInsurance: Sponsored bet amount is 0");
        require(
            _sponsoredParticipants[account] == address(0),
            "FlightDelayInsurance: Already participated"
        );
        require(
            address(this).balance >= _sponsoredBetAmount,
            "FlightDelayInsurance: Insufficient sponsor balance"
        );
    }

    function _createMarket(
        bool betYes,
        TrustusPacket calldata packet,
        uint256 participationValue,
        bool sponsored
    ) internal {
        // TODO: extract config
        (
            IMarket.Config memory config,
            string memory flightName,
            uint64 departureDate,
            uint32 delay
        ) = abi.decode(packet.payload, (IMarket.Config, string, uint64, uint32));

        // TODO: add "private market"
        require(config.cutoffTime > block.timestamp, "Cannot create closed market");

        FlightDelayMarketFactory factory = FlightDelayMarketFactory(_registry.getAddress(1));

        bytes32 marketId = factory.getMarketId(flightName, departureDate, delay);
        require(address(_markets[marketId]) == address(0), "Market already exists");

        uint256 uniqueId = _marketUniqueIdCounter;
        FlightDelayMarket market = factory.createMarket(
            uniqueId,
            marketId,
            config,
            FlightDelayMarket.FlightInfo(flightName, departureDate, delay)
        );
        _markets[marketId] = market;
        _lpWallet.provideLiquidity(market, config.lpBid);

        market.registerParticipant{value: participationValue}(_msgSender(), betYes, sponsored);

        _marketUniqueIdCounter += market.tokenSlots();

        emit FlightDelayMarketCreated(marketId, uniqueId, _msgSender());
        if (sponsored) {
            _sponsoredParticipants[_msgSender()] = address(market);
            emit FlightDelayMarketSponsored(marketId, _msgSender(), participationValue, betYes);
        }
    }

    function _msgSender() internal view virtual override returns (address sender) {
        if (isTrustedForwarder(msg.sender)) {
            // The assembly code is more direct than the Solidity version using `abi.decode`.
            /// @solidity memory-safe-assembly
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            return super._msgSender();
        }
    }

    function _msgData() internal view virtual override returns (bytes calldata) {
        if (isTrustedForwarder(msg.sender)) {
            return msg.data[:msg.data.length - 20];
        } else {
            return super._msgData();
        }
    }

    receive() external payable {}
}
