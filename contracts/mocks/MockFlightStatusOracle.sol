// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "../interfaces/IFlightStatusOracle.sol";

contract MockFlightStatusOracle is IFlightStatusOracle {
    event RequestFlightStatus(
        string flightName,
        uint64 departureDate,
        address caller,
        bytes4 callback
    );

    event RequestCreated(bytes32 requestId);

    event FulfillFlightStatus(bytes32 requestId, bytes1 status, uint32 delay);

    struct RequestMetadata {
        address caller;
        bytes4 selector;
    }

    mapping(bytes32 => RequestMetadata) private _requestsInProgress;

    function requestFlightStatus(
        string calldata flightName,
        uint64 departureDate,
        bytes4 callback
    ) external override returns (bytes32 requestId) {
        requestId = keccak256(abi.encode(flightName, departureDate, callback));
        _requestsInProgress[requestId] = RequestMetadata(msg.sender, callback);

        emit RequestCreated(requestId);
        emit RequestFlightStatus(flightName, departureDate, msg.sender, callback);
    }

    function fulfillFlightStatus(bytes32 requestId, bytes1 status, uint32 delay) external {
        RequestMetadata storage metadata = _requestsInProgress[requestId];
        require(metadata.caller != address(0), "Unknown request");
        bytes memory payload = abi.encode(status, delay);

        (bool success, ) = metadata.caller.call(abi.encodeWithSelector(metadata.selector, payload));
        require(success, "MockFlightStatusOracle: failed to call caller");

        delete _requestsInProgress[requestId];

        emit FulfillFlightStatus(requestId, status, delay);
    }
}
