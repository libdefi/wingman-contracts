// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "./interfaces/IFlightStatusOracle.sol";
import "./interfaces/IProduct.sol";
import "./PredictionMarket.sol";

contract FlightDelayMarket is PredictionMarket {
    event FlightCompleted(
        string indexed flightName,
        uint64 indexed departureDate,
        bytes1 status,
        uint32 delay
    );

    struct FlightInfo {
        string flightName;
        uint64 departureDate;
        uint32 delay;
    }

    struct Outcome {
        bytes1 status;
        uint32 delay;
    }

    FlightInfo private _flightInfo;
    Outcome private _outcome;

    constructor(
        FlightInfo memory flightInfo_,
        Config memory config_,
        uint256 uniqueId_,
        bytes32 marketId_,
        ITokensRepository tokensRepo_,
        address payable feeCollector_,
        IProduct product_,
        address trustedForwarder_
    ) PredictionMarket(config_, uniqueId_, marketId_, tokensRepo_, feeCollector_, product_, trustedForwarder_) {
        _flightInfo = flightInfo_;
    }

    function flightInfo() external view returns (FlightInfo memory) {
        return _flightInfo;
    }

    function outcome() external view returns (Outcome memory) {
        return _outcome;
    }

    function _trySettle() internal override {
        IFlightStatusOracle(_config.oracle).requestFlightStatus(
            _flightInfo.flightName,
            _flightInfo.departureDate,
            this.recordDecision.selector
        );
    }

    function _renderDecision(
        bytes calldata payload
    ) internal override returns (DecisionState state, Result result) {
        (bytes1 status, uint32 delay) = abi.decode(payload, (bytes1, uint32));

        if (status == "C") {
            // YES wins
            state = DecisionState.DECISION_RENDERED;
            result = Result.YES;
        } else if (status == "L") {
            state = DecisionState.DECISION_RENDERED;

            if (delay >= _flightInfo.delay) {
                // YES wins
                result = Result.YES;
            } else {
                // NO wins
                result = Result.NO;
            }
        } else {
            // not arrived yet
            // will have to reschedule the check
            state = DecisionState.DECISION_NEEDED;
            // TODO: also add a cooldown mechanism
        }

        if (state == DecisionState.DECISION_RENDERED) {
            _outcome = Outcome(status, delay);
            emit FlightCompleted(_flightInfo.flightName, _flightInfo.departureDate, status, delay);
        }
    }
}
