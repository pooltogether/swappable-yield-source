// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.7.6;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";

import "../SwappableYieldSource.sol";

/* solium-disable security/no-block-members */
contract SwappableYieldSourceHarness is SwappableYieldSource {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  function requireYieldSource(IYieldSource _yieldSource) public view returns (address) {
    return _requireYieldSource(_yieldSource);
  }

  function mint(address _account, uint256 _amount) public returns (bool) {
    _mint(_account, _amount);
    return true;
  }

  function mintShares(uint256 _mintAmount, address _to) public {
    return _mintShares(_mintAmount, _to);
  }

  function burnShares(uint256 _burnAmount) public {
    return _burnShares(_burnAmount);
  }

  function tokenToShares(uint256 _tokens) external returns (uint256) {
    return _tokenToShares(_tokens);
  }

  function sharesToToken(uint256 _shares) external returns (uint256) {
    return _sharesToToken(_shares);
  }

  function setYieldSource(IYieldSource _oldYieldSource, IYieldSource _newYieldSource) external {
    _setYieldSource(_oldYieldSource, _newYieldSource);
  }

  function transferFunds(IYieldSource _oldYieldSource, IYieldSource _newYieldSource) external {
    IERC20Upgradeable(depositToken).safeApprove(address(_newYieldSource), type(uint256).max);
    _transferFunds(_oldYieldSource, _newYieldSource);
  }
}
