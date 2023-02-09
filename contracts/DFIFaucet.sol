// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract DFIFaucet is ERC2771Context, Ownable {
    event Drip(address indexed to, uint256 amount);

    mapping (address => uint256) private _drips;

    uint256 private _dripAmount = 0.05 ether;

    constructor(address forwarder)
        Ownable()
        ERC2771Context(forwarder)
    {}

    function dripAmount() external view returns (uint256) {
        return _dripAmount;
    }

    function dripped(address to) external view returns (uint256) {
        return _drips[to];
    }

    function withdraw() external onlyOwner {
        _sendFunds(_msgSender(), address(this).balance);
    }

    function drip() external {
        require(_drips[_msgSender()] == 0, "DFIFaucet: Already dripped");
        _drips[_msgSender()] = _dripAmount;

        _sendFunds(_msgSender(), _dripAmount);
        emit Drip(_msgSender(), _dripAmount);
    }

    function setDripAmount(uint256 dripAmount_) external onlyOwner {
        _dripAmount = dripAmount_;
    }

    function _sendFunds(address to, uint256 amount) internal {
        // slither-disable-next-line arbitrary-send-eth
        (bool sent, ) = payable(to).call{value: amount}("");
        require(sent, "Can't send");
    }

    function _msgSender() internal view virtual override(ERC2771Context, Context) returns (address sender) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(ERC2771Context, Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    receive() external payable {}
}