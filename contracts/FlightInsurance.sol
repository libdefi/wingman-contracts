// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./Trustus.sol";
import "./LPWallet.sol";

import "./interfaces/IFlightStatusOracle.sol";
import "./interfaces/ITokensRepository.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IProduct.sol";
import "./interfaces/IRegistry.sol";
import "./utils/RegistryMixin.sol";
import "./FlightDelayMarketFactory.sol";
import "./FlightDelayMarket.sol";

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
        uint256 amount
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

        market.registerParticipant{value: msg.value}(_msgSender(), betYes);

        _marketUniqueIdCounter += market.tokenSlots();

        emit FlightDelayMarketCreated(marketId, uniqueId, _msgSender());
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

    function wallet() external view returns (address) {
        return address(_lpWallet);
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

    function onMarketParticipate(
        bytes32 marketId,
        address account,
        uint256 value,
        bool betYes,
        uint256 amount
    ) external override {
        require(msg.sender == address(_markets[marketId]), "Invalid market");
        emit FlightDelayMarketParticipated(marketId, account, value, betYes, amount);
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
}
