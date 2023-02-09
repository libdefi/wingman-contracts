// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "./interfaces/ITokensRepository.sol";
import "./interfaces/IProduct.sol";
import "./interfaces/IRegistry.sol";
import "./utils/RegistryMixin.sol";
import "./FlightDelayMarket.sol";

contract FlightDelayMarketFactory is RegistryMixin {
    constructor(IRegistry registry_) {
        _setRegistry(registry_);
    }

    function createMarket(
        uint256 uniqueId,
        bytes32 marketId,
        PredictionMarket.Config calldata config,
        FlightDelayMarket.FlightInfo calldata flightInfo
    ) external onlyProduct returns (FlightDelayMarket) {
        FlightDelayMarket market = new FlightDelayMarket(
            flightInfo,
            config,
            uniqueId,
            marketId,
            ITokensRepository(_registry.getAddress(2)) /* tokens repo */,
            payable(_registry.getAddress(100)) /* fee collector */,
            IProduct(msg.sender),
            _registry.getAddress(101) /* trusted forwarder */
        );
        return market;
    }

    function getMarketId(
        string calldata flightName,
        uint64 departureDate,
        uint32 delay
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(flightName, departureDate, delay));
    }
}
