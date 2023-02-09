// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./interfaces/IFlightStatusOracle.sol";
import "./interfaces/IRegistry.sol";
import "./utils/RegistryMixin.sol";

contract FlightStatusOracle is IFlightStatusOracle, ChainlinkClient, AccessControl, RegistryMixin {
    event FlightStatusRequested(
        bytes32 indexed requestId,
        bytes flightName,
        uint64 departureDate
    );

    event FlightStatusFulfilled(bytes32 indexed requestId, bytes1 status, uint32 delay);

    event FlightStatusFulfillError(bytes32 indexed requestId, bytes err);

    using Chainlink for Chainlink.Request;

    struct RequestMetadata {
        address caller;
        bytes4 selector;
        bool hasError;
        uint256 createdAt;
    }

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    uint256 private constant TIMEOUT = 15 minutes;

    uint256 private _chainlinkFee;
    bytes32 private _chainlinkJobId;

    mapping(bytes32 => RequestMetadata) private _requestsInProgress;

    constructor(
        address chainlinkToken_,
        address chainlinkOracle_,
        bytes32 chainlinkJobId_,
        IRegistry registry_
    ) {
        _setRegistry(registry_);

        setChainlinkToken(chainlinkToken_);
        setChainlinkOracle(chainlinkOracle_);

        _chainlinkFee = (1 * LINK_DIVISIBILITY) / 10; // 0.1
        _chainlinkJobId = chainlinkJobId_;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    function requestFlightStatus(
        string calldata flightName,
        uint64 departureDate,
        bytes4 callback
    ) external override onlyMarket(_msgSender())
    returns (bytes32 requestId) {
        Chainlink.Request memory req = buildChainlinkRequest(
            _chainlinkJobId,
            address(this),
            this.fulfillFlightStatus.selector
        );

        req.add("flight", flightName);
        req.add("departure", Strings.toString(departureDate));

        requestId = sendChainlinkRequest(req, _chainlinkFee);

        _requestsInProgress[requestId] = RequestMetadata(msg.sender, callback, false, block.timestamp);

        emit FlightStatusRequested(requestId, bytes(flightName), departureDate);
    }

    function fulfillFlightStatus(
        bytes32 requestId,
        bytes1 status,
        uint32 delay,
        bytes calldata err
    ) external recordChainlinkFulfillment(requestId) {
        RequestMetadata storage metadata = _requestsInProgress[requestId];
        require(metadata.caller != address(0), "Unknown request");

        if (err.length > 0) {
            metadata.hasError = true;
            emit FlightStatusFulfillError(requestId, err);
            return;
        }

        _sendCallback(metadata, requestId, status, delay);
    }

    function manualFulfillment(
        bytes32 requestId,
        bytes1 status,
        uint32 delay
    ) external onlyRole(MANAGER_ROLE) {
        RequestMetadata storage metadata = _requestsInProgress[requestId];
        require(metadata.caller != address(0), "Unknown request");
        require(metadata.hasError || metadata.createdAt < block.timestamp - TIMEOUT, "Too early");

        _sendCallback(metadata, requestId, status, delay);
    }

    function _sendCallback(RequestMetadata storage metadata, bytes32 requestId, bytes1 status, uint32 delay) internal {
        bytes memory payload = abi.encode(status, delay);

        (bool sent, ) = metadata.caller.call(abi.encodeWithSelector(metadata.selector, payload));
        require(sent, "Cannot send callback");

        delete _requestsInProgress[requestId];

        emit FlightStatusFulfilled(requestId, status, delay);
    }
}
