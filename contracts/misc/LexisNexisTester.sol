// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LexisNexisTester is Ownable, ChainlinkClient {
    using Chainlink for Chainlink.Request;

    event FlightStatusReceived(FlightStatus flight);

    struct FlightStatus {
        uint8 status;
        bytes3 departureAirport;
        bytes3 arrivalAirport;
        uint40 publishedDepartureTime;
        uint40 publishedArrivalTime;
        uint40 actualRunwayDepartureTime;
        uint40 actualRunwayArrivalTime;
        uint40 actualGateArrivalTime;
    }

    uint256 private _chainlinkFee;
    bytes32 private _chainlinkJobId;

    constructor(address chainlinkToken_, address chainlinkOracle_, bytes32 chainlinkJobId_) {
        setChainlinkToken(chainlinkToken_);
        setChainlinkOracle(chainlinkOracle_);

        _chainlinkFee = (1 * LINK_DIVISIBILITY) / 10; // 0.1
        _chainlinkJobId = chainlinkJobId_;
    }

    function requestFlightStatus(string calldata _flight, uint256 _departure) external onlyOwner {
        Chainlink.Request memory req = buildChainlinkRequest(
            _chainlinkJobId,
            address(this),
            this.fulfillFlightStatus.selector
        );

        req.add("flight", _flight);
        req.addUint("departure", _departure);

        sendChainlinkRequest(req, _chainlinkFee);
    }

    function fulfillFlightStatus(
        bytes32 _requestId,
        bytes32 _result
    ) external recordChainlinkFulfillment(_requestId) {
        FlightStatus memory flight = _getFlightStatusStruct(_result);
        emit FlightStatusReceived(flight);
    }

    function _getFlightStatusStruct(bytes32 _data) internal pure returns (FlightStatus memory) {
        FlightStatus memory flight = FlightStatus(
            uint8(bytes1(_data)),
            bytes3(_data << 8),
            bytes3(_data << 32),
            uint40(bytes5(_data << 56)),
            uint40(bytes5(_data << 96)),
            uint40(bytes5(_data << 136)),
            uint40(bytes5(_data << 176)),
            uint40(bytes5(_data << 216))
        );
        return flight;
    }
}
