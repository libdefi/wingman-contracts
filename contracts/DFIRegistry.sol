// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./interfaces/IRegistry.sol";

contract DFIRegistry is IRegistry, OwnableUpgradeable, UUPSUpgradeable {
    event RegistryUpdated(uint64 indexed id, address indexed addr);

    mapping(uint64 => address) private _idToAddr;
    mapping(address => uint64) private _addrToId;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    function getAddress(uint64 id) external view override returns (address) {
        return _idToAddr[id];
    }

    function getId(address addr) external view override returns (uint256) {
        return _addrToId[addr];
    }

    function setAddresses(uint64[] calldata ids, address[] calldata addrs) external onlyOwner {
        require(ids.length == addrs.length, "DFIRegistry: invalid input length");

        for (uint32 i = 0; i < ids.length; i++) {
            _idToAddr[ids[i]] = addrs[i];
            _addrToId[addrs[i]] = ids[i];
            emit RegistryUpdated(ids[i], addrs[i]);
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
