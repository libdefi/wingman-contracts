// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract DFIFaucet is ERC2771Context, AccessControl {
    event Drip(address indexed to, uint256 amount);

    bytes32 public constant DRIPPER_ROLE = keccak256("DRIPPER_ROLE");

    mapping (address => uint256) private _drips;

    uint256 private _dripAmount = 0.05 ether;

    constructor(address forwarder)
        ERC2771Context(forwarder)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DRIPPER_ROLE, msg.sender);
    }

    function dripAmount() external view returns (uint256) {
        return _dripAmount;
    }

    function dripped(address to) external view returns (uint256) {
        return _drips[to];
    }

    function withdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _sendFunds(_msgSender(), address(this).balance);
    }

    function drip() external {
        _drip(_msgSender());
    }

    function dripTo(address to) external onlyRole(DRIPPER_ROLE) {
        _drip(to);
    }

    function setDripAmount(uint256 dripAmount_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _dripAmount = dripAmount_;
    }

    function _sendFunds(address to, uint256 amount) internal {
        // slither-disable-next-line arbitrary-send-eth
        (bool sent, ) = payable(to).call{value: amount}("");
        require(sent, "Can't send");
    }

    function _drip(address to) internal {
        require(_drips[to] == 0, "DFIFaucet: Already dripped");
        _drips[to] = _dripAmount;

        _sendFunds(to, _dripAmount);
        emit Drip(to, _dripAmount);
    }

    function _msgSender() internal view virtual override(ERC2771Context, Context) returns (address sender) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(ERC2771Context, Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    receive() external payable {}
}