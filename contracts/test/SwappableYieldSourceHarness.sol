// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.7.6;

import "../SwappableYieldSource.sol";

/* solium-disable security/no-block-members */
contract SwappableYieldSourceHarness is SwappableYieldSource {
  function requireYieldSource(IYieldSource _yieldSource) public view {
    return _requireYieldSource(_yieldSource);
  }

  function mint(address account, uint256 amount) public returns (bool) {
    _mint(account, amount);
    return true;
  }

  function mintShares(uint256 mintAmount, address to) public {
    return _mintShares(mintAmount, to);
  }

  function burnShares(uint256 burnAmount) public {
    return _burnShares(burnAmount);
  }

  function tokenToShares(uint256 tokens) external returns (uint256) {
    return _tokenToShares(tokens);
  }

  function sharesToToken(uint256 shares) external returns (uint256) {
    return _sharesToToken(shares);
  }

  function setYieldSource(IYieldSource _oldYieldSource, IYieldSource _newYieldSource) external {
    _setYieldSource(_oldYieldSource, _newYieldSource);
  }

  function transferFunds(IYieldSource _oldYieldSource, IYieldSource _newYieldSource) external {
    _transferFunds(_oldYieldSource, _newYieldSource);
  }
}
