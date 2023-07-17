// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ITokensRepository } from "./interfaces/ITokensRepository.sol";
import { IProduct } from "./interfaces/IProduct.sol";
import { IRegistry } from "./interfaces/IRegistry.sol";
import { RegistryMixin } from "./utils/RegistryMixin.sol";
import { PredictionMarket } from "./PredictionMarket.sol";
import { FlightDelayMarket } from "./FlightDelayMarket.sol";

contract FlightDelayMarketFactory is RegistryMixin {
    address private immutable implementation;

    constructor(IRegistry registry_) {
        _setRegistry(registry_);

        implementation = address(new FlightDelayMarket());
    }

    function createMarket(
        uint256 uniqueId,
        bytes32 marketId,
        PredictionMarket.Config calldata config,
        FlightDelayMarket.FlightInfo calldata flightInfo
    ) external onlyProduct returns (FlightDelayMarket) {
        FlightDelayMarket market = FlightDelayMarket(Clones.clone(implementation));
        market.initialize(
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
