// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC1155ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155ReceiverUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { ILPWallet } from "./interfaces/ILPWallet.sol";
import { IMarket } from "./interfaces/IMarket.sol";
import { IRegistry } from "./interfaces/IRegistry.sol";
import { RegistryMixinUpgradeable } from "./utils/RegistryMixin.sol";

contract LPWallet is
    ILPWallet,
    ERC1155ReceiverUpgradeable,
    OwnableUpgradeable,
    RegistryMixinUpgradeable,
    UUPSUpgradeable
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IRegistry registry_) public initializer {
        __Ownable_init();
        __ERC1155Receiver_init();
        __RegistryMixin_init(registry_);
        __UUPSUpgradeable_init();
    }

    function provideLiquidity(IMarket market, uint256 amount) external override onlyProduct {
        // slither-disable-next-line arbitrary-send-eth
        bool success = market.provideLiquidity{value: amount}();
        require(success, "Can't provide liquidity");
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        (bool sent, ) = payable(to).call{value: amount}("");
        require(sent, "Can't withdraw");
    }

    function onERC1155Received(
        address operator,
        address,
        uint256 tokenId,
        uint256,
        bytes calldata
    ) external view onlyMarketTokens(operator, tokenId) returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address,
        uint256[] calldata tokenIds,
        uint256[] calldata,
        bytes calldata
    ) external view onlyMarketTokensMultiple(operator, tokenIds) returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    receive() external payable {}
}
