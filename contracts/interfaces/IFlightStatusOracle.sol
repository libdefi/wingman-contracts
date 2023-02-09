// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

interface IFlightStatusOracle {
    function requestFlightStatus(
        string calldata flightName,
        uint64 departureDate,
        bytes4 callback
    ) external returns (bytes32);
}
