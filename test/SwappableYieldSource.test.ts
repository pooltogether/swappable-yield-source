import YieldSourceInterface from '@pooltogether/yield-source-interface/abis/IYieldSource.json';
import { Signer } from '@ethersproject/abstract-signer';
import { BigNumber } from '@ethersproject/bignumber';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { MockContract } from 'ethereum-waffle';
import { ethers, waffle } from 'hardhat';

import {
  ERC20Mintable,
  YieldSourceHarness,
  SwappableYieldSourceHarness,
  ERC20Mintable__factory,
} from '../types';
import { ContractFactory } from 'ethers';

const { AddressZero, MaxUint256, Zero } = ethers.constants;

describe('SwappableYieldSource', () => {
  let contractsOwner: Signer;
  let yieldSourceOwner: SignerWithAddress;
  let wallet2: SignerWithAddress;

  let ERC20MintableContract: ERC20Mintable__factory;
  let YieldSourceHarnessContract: ContractFactory;

  let daiTokenMock: MockContract;
  let yieldSourceMock: MockContract;

  let yieldSource: YieldSourceHarness;
  let replacementYieldSource: YieldSourceHarness;
  let swappableYieldSource: SwappableYieldSourceHarness;

  let daiToken: ERC20Mintable;
  let aDaiToken: ERC20Mintable;

  let isInitializeTest = false;

  const initializeSwappableYieldSource = async (
    yieldSourceAddress: string,
    decimals: number,
    ownerAddress: string,
  ) => {
    await swappableYieldSource.initialize(
      yieldSourceAddress,
      decimals,
      'swsDAI',
      'PoolTogether Swappable Yield Source DAI',
      ownerAddress,
    );
  };

  const supplyTokenTo = async (userAmount: BigNumber, user: SignerWithAddress) => {
    const userAddress = user.address;

    await daiToken.mint(userAddress, userAmount);
    await daiToken.connect(user).approve(swappableYieldSource.address, MaxUint256);
    await daiToken.connect(user).approve(yieldSource.address, MaxUint256);

    await swappableYieldSource.connect(user).supplyTokenTo(userAmount, userAddress);
  };

  const tokenToShares = async (tokens: BigNumber) => {
    const scale = BigNumber.from(10).pow(18);
    const totalShares = await swappableYieldSource.callStatic.totalSupply();
    const yieldSourceTotalSupply = await yieldSource.callStatic.balanceOfToken(
      swappableYieldSource.address,
    );

    // shares = tokens * (totalShares / yieldSourceTotalSupply)
    const exchangeRateMantissa = totalShares.mul(scale).div(yieldSourceTotalSupply);
    return exchangeRateMantissa.mul(tokens).div(scale);
  };

  const sharesToToken = async (shares: BigNumber) => {
    const scale = BigNumber.from(10).pow(18);
    const totalShares = await swappableYieldSource.callStatic.totalSupply();
    const yieldSourceTotalSupply = await yieldSource.callStatic.balanceOfToken(
      swappableYieldSource.address,
    );

    // tokens = shares * (yieldSourceTotalSupply / totalShares)
    const exchangeRateMantissa = yieldSourceTotalSupply.mul(scale).div(totalShares)
    return exchangeRateMantissa.mul(shares).div(scale);
  };

  const { getContractAt, getContractFactory, getSigners, utils } = ethers;
  const { deployMockContract } = waffle;
  const { parseEther: toWei, parseUnits } = utils;

  beforeEach(async () => {
    [contractsOwner, yieldSourceOwner, wallet2] = await getSigners();

    ERC20MintableContract = await getContractFactory('ERC20Mintable', contractsOwner);

    daiToken = await ERC20MintableContract.deploy('Dai Stablecoin', 'DAI', 18);
    aDaiToken = await ERC20MintableContract.deploy('Aave interest bearing DAI ', 'aDAI', 18);

    YieldSourceHarnessContract = await getContractFactory('YieldSourceHarness', contractsOwner);

    daiTokenMock = await deployMockContract(contractsOwner, ERC20Mintable__factory.abi);

    yieldSourceMock = await deployMockContract(contractsOwner, YieldSourceInterface);
    await yieldSourceMock.mock.depositToken.returns(daiTokenMock.address);

    yieldSource = (await YieldSourceHarnessContract.deploy(daiToken.address)) as YieldSourceHarness;
    replacementYieldSource = (await YieldSourceHarnessContract.deploy(
      daiToken.address,
    )) as YieldSourceHarness;

    const SwappableYieldSource = await getContractFactory('SwappableYieldSourceHarness');
    const hardhatSwappableYieldSourceHarness = await SwappableYieldSource.deploy();

    swappableYieldSource = (await getContractAt(
      'SwappableYieldSourceHarness',
      hardhatSwappableYieldSourceHarness.address,
      contractsOwner,
    )) as SwappableYieldSourceHarness;

    if (!isInitializeTest) {
      await initializeSwappableYieldSource(yieldSource.address, 18, yieldSourceOwner.address);
    }
  });

  describe('initialize()', () => {
    before(() => {
      isInitializeTest = true;
    });

    after(() => {
      isInitializeTest = false;
    });

    it('should fail if yieldSource is address zero', async () => {
      await expect(
        initializeSwappableYieldSource(AddressZero, 18, yieldSourceOwner.address),
      ).to.be.revertedWith('SwappableYieldSource/yieldSource-not-zero-address');
    });

    it('should fail if yieldSource address is not a yield source', async () => {
      const randomWallet = ethers.Wallet.createRandom();

      await expect(
        initializeSwappableYieldSource(randomWallet.address, 18, yieldSourceOwner.address),
      ).to.be.revertedWith('Transaction reverted: function call to a non-contract account');
    });

    it('should fail if yieldSource depositToken is address zero', async () => {
      const yieldSourceAddressZero = await YieldSourceHarnessContract.deploy(AddressZero);

      await expect(
        initializeSwappableYieldSource(
          yieldSourceAddressZero.address,
          18,
          yieldSourceOwner.address,
        ),
      ).to.be.revertedWith('SwappableYieldSource/invalid-yield-source');
    });

    it('should fail if owner is address zero', async () => {
      await expect(
        initializeSwappableYieldSource(yieldSource.address, 18, AddressZero),
      ).to.be.revertedWith('Ownable: new owner is the zero address');
    });
  });

  describe('create()', () => {
    it('should create SwappableYieldSource', async () => {
      expect(await swappableYieldSource.yieldSource()).to.equal(yieldSource.address);
      expect(await swappableYieldSource.owner()).to.equal(yieldSourceOwner.address);
    });
  });

  describe('assetManager()', () => {
    it('should setAssetManager', async () => {
      await expect(swappableYieldSource.connect(yieldSourceOwner).setAssetManager(wallet2.address))
        .to.emit(swappableYieldSource, 'AssetManagerTransferred')
        .withArgs(AddressZero, wallet2.address);

      expect(await swappableYieldSource.assetManager()).to.equal(wallet2.address);
    });

    it('should fail to setAssetManager', async () => {
      await expect(
        swappableYieldSource.connect(yieldSourceOwner).setAssetManager(AddressZero),
      ).to.be.revertedWith('onlyOwnerOrAssetManager/assetManager-not-zero-address');
    });
  });

  describe('approveMaxAmount()', () => {
    it('should approve yieldSource to spend max uint256 amount', async () => {
      expect(
        await swappableYieldSource.connect(yieldSourceOwner).callStatic.approveMaxAmount(),
      ).to.equal(true);

      expect(await daiToken.allowance(swappableYieldSource.address, yieldSource.address)).to.equal(
        MaxUint256,
      );
    });
  });

  describe('depositToken()', () => {
    it('should return the underlying token', async () => {
      expect(await swappableYieldSource.depositToken()).to.equal(daiToken.address);
    });
  });

  describe('balanceOfToken()', () => {
    it('should return user balance', async () => {
      await supplyTokenTo(toWei('500'), yieldSourceOwner);
      await supplyTokenTo(toWei('100'), wallet2);

      const shares = await swappableYieldSource.callStatic.balanceOf(wallet2.address);
      const tokens = await sharesToToken(shares);

      expect(await swappableYieldSource.callStatic.balanceOfToken(wallet2.address)).to.equal(
        tokens,
      );
    });
  });

  describe('_tokenToShares()', () => {
    it('should return shares amount', async () => {
      await supplyTokenTo(toWei('500'), yieldSourceOwner);
      await supplyTokenTo(toWei('100'), wallet2);

      const tokens = toWei('10');
      const shares = await tokenToShares(tokens);

      expect(await swappableYieldSource.callStatic.tokenToShares(tokens)).to.equal(shares);
    });

    it('should return 0 if tokens param is 0', async () => {
      expect(await swappableYieldSource.callStatic.tokenToShares('0')).to.equal('0');
    });

    it('should return tokens if totalSupply is 0', async () => {
      expect(await swappableYieldSource.callStatic.tokenToShares(toWei('100'))).to.equal(
        toWei('100'),
      );
    });

    it('should return shares even if yield source total supply has a lot of decimals', async () => {
      await supplyTokenTo(toWei('0.000000000000000001'), yieldSourceOwner);

      const tokens = toWei('0.000000000000000005');
      const shares = await tokenToShares(tokens);

      expect(await swappableYieldSource.callStatic.tokenToShares(tokens)).to.equal(shares);
    });

    it('should return shares even if yield source total supply increases', async () => {
      await supplyTokenTo(toWei('500'), yieldSourceOwner);
      await supplyTokenTo(toWei('100'), wallet2);

      const tokens = toWei('1');
      const shares = await tokenToShares(tokens);

      expect(await swappableYieldSource.callStatic.tokenToShares(tokens)).to.equal(shares);

      await supplyTokenTo(parseUnits('100', 36), wallet2);

      const smallShares = await tokenToShares(tokens);

      expect(await swappableYieldSource.callStatic.tokenToShares(tokens)).to.equal(smallShares);
    });

    it('should fail to return shares if yield source total supply increases too much', async () => {
      await supplyTokenTo(toWei('500'), yieldSourceOwner);
      await supplyTokenTo(toWei('100'), wallet2);

      const tokens = toWei('1');
      const shares = await tokenToShares(tokens);

      expect(await swappableYieldSource.callStatic.tokenToShares(tokens)).to.equal(shares);

      await expect(supplyTokenTo(parseUnits('100', 37), wallet2)).to.be.revertedWith(
        'SwappableYieldSource/shares-gt-zero',
      );
    });
  });

  describe('_sharesToToken()', () => {
    it('should return tokens amount', async () => {
      await supplyTokenTo(toWei('500'), yieldSourceOwner);
      await supplyTokenTo(toWei('100'), wallet2);

      const shares = toWei('2');
      const tokens = await sharesToToken(shares);

      expect(await swappableYieldSource.callStatic.sharesToToken(shares)).to.equal(tokens);
    });

    it('should return shares if totalSupply is 0', async () => {
      expect(await swappableYieldSource.callStatic.sharesToToken(toWei('100'))).to.equal(
        toWei('100'),
      );
    });

    it('should return tokens even if totalSupply has a lot of decimals', async () => {
      await supplyTokenTo(toWei('0.000000000000000001'), yieldSourceOwner);

      const shares = toWei('0.000000000000000005');
      const tokens = await sharesToToken(shares);

      expect(await swappableYieldSource.callStatic.sharesToToken(shares)).to.equal(tokens);
    });

    it('should return tokens even if yield source total supply increases', async () => {
      await supplyTokenTo(toWei('500'), yieldSourceOwner);
      await supplyTokenTo(toWei('100'), wallet2);

      const shares = toWei('1');
      const tokens = await sharesToToken(shares);

      expect(await swappableYieldSource.callStatic.sharesToToken(shares)).to.equal(tokens);

      await supplyTokenTo(parseUnits('100', 36), wallet2);

      const smallTokens = await sharesToToken(shares);

      expect(await swappableYieldSource.callStatic.sharesToToken(shares)).to.equal(smallTokens);
    });

    it('should failt to return tokens if yield source total supply increases too much', async () => {
      await supplyTokenTo(toWei('500'), yieldSourceOwner);
      await supplyTokenTo(toWei('100'), wallet2);

      const shares = toWei('1');
      const tokens = await sharesToToken(shares);

      expect(await swappableYieldSource.callStatic.sharesToToken(shares)).to.equal(tokens);

      await expect(supplyTokenTo(parseUnits('100', 37), wallet2)).to.be.revertedWith(
        'SwappableYieldSource/shares-gt-zero',
      );
    });
  });

  describe('supplyTokenTo()', () => {
    let amount: BigNumber;

    beforeEach(async () => {
      amount = toWei('100');
    });

    it('should supply assets if totalSupply is 0', async () => {
      await supplyTokenTo(amount, yieldSourceOwner);
      expect(await swappableYieldSource.totalSupply()).to.equal(amount);
    });

    it('should supply assets if totalSupply is not 0', async () => {
      await supplyTokenTo(amount, yieldSourceOwner);
      await supplyTokenTo(amount, wallet2);

      const shares = await tokenToShares(amount.mul(2));
      expect(await swappableYieldSource.totalSupply()).to.equal(shares);
    });

    it('should revert on error', async () => {
      await expect(
        swappableYieldSource.supplyTokenTo(amount, swappableYieldSource.address),
      ).to.be.revertedWith('');
    });
  });

  describe('redeemToken()', () => {
    let yieldSourceOwnerBalance: BigNumber;
    let redeemAmount: BigNumber;

    beforeEach(() => {
      yieldSourceOwnerBalance = toWei('300');
      redeemAmount = toWei('100');
    });

    it('should redeem assets', async () => {
      await supplyTokenTo(redeemAmount, yieldSourceOwner);

      await swappableYieldSource.connect(yieldSourceOwner).redeemToken(redeemAmount);

      expect(await daiToken.balanceOf(yieldSourceOwner.address)).to.equal(redeemAmount);
      expect(await swappableYieldSource.totalSupply()).to.equal(Zero);
    });

    it('should not be able to redeem assets if balance is 0', async () => {
      await swappableYieldSource.mint(yieldSourceOwner.address, toWei('0'));

      await expect(
        swappableYieldSource.connect(yieldSourceOwner).redeemToken(redeemAmount),
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });

    it('should fail to redeem if amount superior to balance', async () => {
      const yieldSourceOwnerLowBalance = toWei('10');
      const revertReason = 'ERC20: burn amount exceeds balance';

      await supplyTokenTo(yieldSourceOwnerLowBalance, yieldSourceOwner);

      await expect(
        swappableYieldSource.connect(yieldSourceOwner).redeemToken(redeemAmount),
      ).to.be.revertedWith(revertReason);
    });
  });

  describe('redeemToken()', () => {
    before(() => {
      isInitializeTest = true;
    });

    after(() => {
      isInitializeTest = false;
    });

    it('should fail to redeemToken if amountRedeemed is different to amountReceived', async () => {
      const yieldSourceBalance = toWei('600');

      await daiTokenMock.mock.allowance
        .withArgs(swappableYieldSource.address, yieldSourceMock.address)
        .returns(ethers.constants.Zero);

      await daiTokenMock.mock.approve.withArgs(yieldSourceMock.address, MaxUint256).returns(true);

      await initializeSwappableYieldSource(yieldSourceMock.address, 18, yieldSourceOwner.address);

      await swappableYieldSource.mint(yieldSourceOwner.address, yieldSourceBalance);

      await yieldSourceMock.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceBalance);

      await yieldSourceMock.mock.redeemToken
        .withArgs(yieldSourceBalance)
        .returns(yieldSourceBalance);

      await daiTokenMock.mock.balanceOf
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceBalance.sub(toWei('200')));

      await expect(
        swappableYieldSource.connect(yieldSourceOwner).redeemToken(yieldSourceBalance),
      ).to.be.revertedWith('SwappableYieldSource/different-redeem-amount');
    });
  });

  describe('setYieldSource()', () => {
    it('should setYieldSource', async () => {
      expect(
        await swappableYieldSource.setYieldSource(
          yieldSource.address,
          replacementYieldSource.address,
        ),
      ).to.emit(swappableYieldSource, 'SwappableYieldSourceSet');

      expect(await swappableYieldSource.yieldSource()).to.equal(replacementYieldSource.address);
      expect(await daiToken.allowance(swappableYieldSource.address, yieldSource.address)).to.equal(
        0,
      );
    });

    it('should fail to setYieldSource if same yield source', async () => {
      await expect(
        swappableYieldSource.setYieldSource(yieldSource.address, yieldSource.address),
      ).to.be.revertedWith('SwappableYieldSource/same-yield-source');
    });

    it('should fail to setYieldSource if depositToken is different', async () => {
      const differentYieldSource = (await YieldSourceHarnessContract.deploy(
        aDaiToken.address,
      )) as YieldSourceHarness;

      await expect(
        swappableYieldSource.setYieldSource(yieldSource.address, differentYieldSource.address),
      ).to.be.revertedWith('SwappableYieldSource/different-deposit-token');
    });
  });

  describe('transferFunds()', () => {
    let yieldSourceOwnerBalance: BigNumber;
    let wallet2Balance: BigNumber;

    beforeEach(() => {
      yieldSourceOwnerBalance = toWei('150');
      wallet2Balance = toWei('150');
    });

    it('should transferFunds', async () => {
      const yieldSourceBalance = yieldSourceOwnerBalance.add(wallet2Balance);

      await supplyTokenTo(yieldSourceOwnerBalance, yieldSourceOwner);
      await supplyTokenTo(wallet2Balance, wallet2);

      expect(
        await swappableYieldSource.transferFunds(
          yieldSource.address,
          replacementYieldSource.address,
        ),
      )
        .to.emit(swappableYieldSource, 'FundsTransferred')
        .withArgs(yieldSource.address, replacementYieldSource.address, yieldSourceBalance);
    });

    it('should succeed to transferFunds if amountRedeemed is inferior to currentBalance', async () => {
      const mintBalance = toWei('200');
      const yieldSourceBalance = yieldSourceOwnerBalance.add(wallet2Balance).add(mintBalance);

      await supplyTokenTo(yieldSourceOwnerBalance, yieldSourceOwner);
      await supplyTokenTo(wallet2Balance, wallet2);

      await daiToken.mint(swappableYieldSource.address, mintBalance);

      expect(
        await swappableYieldSource.transferFunds(
          yieldSource.address,
          replacementYieldSource.address,
        ),
      )
        .to.emit(swappableYieldSource, 'FundsTransferred')
        .withArgs(yieldSource.address, replacementYieldSource.address, yieldSourceBalance);
    });
  });

  describe('transferFunds()', () => {
    before(() => {
      isInitializeTest = true;
    });

    after(() => {
      isInitializeTest = false;
    });

    it('should fail to transferFunds if amountRedeemed is superior to currentBalance', async () => {
      const yieldSourceBalance = toWei('600');

      await daiTokenMock.mock.allowance
        .withArgs(swappableYieldSource.address, yieldSourceMock.address)
        .returns(ethers.constants.Zero);

      await daiTokenMock.mock.approve.withArgs(yieldSourceMock.address, MaxUint256).returns(true);

      await initializeSwappableYieldSource(yieldSourceMock.address, 18, yieldSourceOwner.address);

      await yieldSourceMock.mock.balanceOfToken
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceBalance);

      await yieldSourceMock.mock.redeemToken
        .withArgs(yieldSourceBalance)
        .returns(yieldSourceBalance);

      await daiTokenMock.mock.allowance
        .withArgs(swappableYieldSource.address, replacementYieldSource.address)
        .returns(ethers.constants.Zero);

      await daiTokenMock.mock.approve
        .withArgs(replacementYieldSource.address, MaxUint256)
        .returns(true);

      await daiTokenMock.mock.balanceOf
        .withArgs(swappableYieldSource.address)
        .returns(yieldSourceBalance.sub(toWei('200')));

      await expect(
        swappableYieldSource.transferFunds(yieldSourceMock.address, replacementYieldSource.address),
      ).to.be.revertedWith('SwappableYieldSource/transfer-amount-inferior');
    });
  });

  describe('swapYieldSource()', () => {
    let yieldSourceBalance: BigNumber;
    let replacementYieldSourceBalance: BigNumber;

    beforeEach(async () => {
      yieldSourceBalance = toWei('300');
      replacementYieldSourceBalance = toWei('600');

      await supplyTokenTo(yieldSourceBalance, yieldSourceOwner);
      await swappableYieldSource.mint(
        replacementYieldSource.address,
        await tokenToShares(replacementYieldSourceBalance),
      );
    });

    it('should swapYieldSource if yieldSourceOwner', async () => {
      const transaction = await swappableYieldSource
        .connect(yieldSourceOwner)
        .swapYieldSource(replacementYieldSource.address);

      expect(transaction)
        .to.emit(swappableYieldSource, 'SwappableYieldSourceSet')
        .withArgs(replacementYieldSource.address);

      expect(transaction)
        .to.emit(swappableYieldSource, 'FundsTransferred')
        .withArgs(yieldSource.address, replacementYieldSource.address, yieldSourceBalance);

      expect(await swappableYieldSource.yieldSource()).to.equal(replacementYieldSource.address);
      expect(await daiToken.allowance(swappableYieldSource.address, yieldSource.address)).to.equal(
        0,
      );
    });

    it('should fail to swapYieldSource if yield source address is address zero', async () => {
      await expect(
        swappableYieldSource.connect(yieldSourceOwner).swapYieldSource(AddressZero),
      ).to.be.revertedWith('SwappableYieldSource/yield-source-not-zero-address');
    });

    it('should fail to swapYieldSource if not yieldSourceOwner', async () => {
      await expect(
        swappableYieldSource.connect(wallet2).swapYieldSource(yieldSource.address),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('transferERC20()', () => {
    const transferAmount = toWei('10');

    it('should transferERC20 if yieldSourceOwner', async () => {
      await daiToken.mint(swappableYieldSource.address, transferAmount);

      await expect(
        swappableYieldSource
          .connect(yieldSourceOwner)
          .transferERC20(daiToken.address, wallet2.address, transferAmount),
      ).to.emit(swappableYieldSource, 'TransferredERC20');
    });

    it('should transferERC20 if assetManager', async () => {
      await daiToken.mint(swappableYieldSource.address, transferAmount);

      await expect(
        swappableYieldSource.connect(yieldSourceOwner).setAssetManager(wallet2.address),
      ).to.emit(swappableYieldSource, 'AssetManagerTransferred');

      await expect(
        swappableYieldSource
          .connect(wallet2)
          .transferERC20(daiToken.address, yieldSourceOwner.address, transferAmount),
      ).to.emit(swappableYieldSource, 'TransferredERC20');
    });

    it('should not allow to transfer yield source token', async () => {
      await expect(
        swappableYieldSource
          .connect(yieldSourceOwner)
          .transferERC20(yieldSource.address, wallet2.address, transferAmount),
      ).to.be.revertedWith('SwappableYieldSource/yield-source-token-transfer-not-allowed');
    });

    it('should fail to transferERC20 if not yieldSourceOwner or assetManager', async () => {
      await expect(
        swappableYieldSource
          .connect(wallet2)
          .transferERC20(daiToken.address, yieldSourceOwner.address, transferAmount),
      ).to.be.revertedWith('onlyOwnerOrAssetManager/owner-or-manager');
    });
  });
});
