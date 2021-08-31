// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.7.6;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import "@pooltogether/fixed-point/contracts/FixedPoint.sol";
import "@pooltogether/yield-source-interface/contracts/IYieldSource.sol";

/**
  * @title Harness implementation of the YieldSource interface
  * @dev This contract allows us to unit test with an ERC20 mintable `depositToken`
  *      instead of mocking return values.
*/
contract YieldSourceHarness is ERC20Upgradeable, IYieldSource {
  using SafeMathUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  address public override depositToken;

  mapping(address => uint256) public balances;

  constructor(address _depositToken) {
    depositToken = _depositToken;
  }

  function balanceOfToken(address _addr) external view override returns (uint256) {
    return balances[_addr];
  }

  function supplyTokenTo(uint256 _amount, address _to) external override {
    IERC20Upgradeable(depositToken).safeTransferFrom(msg.sender, address(this), _amount);
    balances[_to] += _amount;
  }

  function redeemToken(uint256 _amount) external override returns (uint256) {
    balances[msg.sender] -= _amount;
    IERC20Upgradeable(depositToken).safeTransfer(msg.sender, _amount);
    return _amount;
  }
}
