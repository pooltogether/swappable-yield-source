import YieldSourceInterface from '@pooltogether/yield-source-interface/abis/IYieldSource.json';
import { Signer } from '@ethersproject/abstract-signer';
import { JsonRpcProvider } from '@ethersproject/providers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { artifacts, deployments, ethers, waffle } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import SafeERC20WrapperUpgradeable from '../abis/SafeERC20WrapperUpgradeable.json';

import { action, alert, info, success } from '../helpers';

import { GenericProxyFactory, IERC20Upgradeable as ERC20, SwappableYieldSource } from '../types';

describe('SwappableYieldSource', () => {
  let contractsOwner: Signer;
  let yieldSourceOwner: SignerWithAddress;
  let wallet2: SignerWithAddress;

  let mockedYieldSource;
  let swappableYieldSource: SwappableYieldSource;

  let erc20Token: ERC20;
  let underlyingToken: ERC20;

  beforeEach(async () => {
    const { getContractAt, getSigners, provider } = ethers;
    const { deployMockContract } = waffle;
    const { getTransactionReceipt } = provider;

    await deployments.fixture();

    [contractsOwner, yieldSourceOwner, wallet2] = await getSigners();

    // action('Mocking tokens...');
    // erc20Token = ((await deployMockContract(
    //   contractsOwner,
    //   SafeERC20WrapperUpgradeable,
    // )) as unknown) as ERC20;

    underlyingToken = (await deployMockContract(
      contractsOwner,
      SafeERC20WrapperUpgradeable,
    )) as unknown as ERC20;

    mockedYieldSource = await deployMockContract(contractsOwner, YieldSourceInterface);
    await mockedYieldSource.mock.depositToken.returns(underlyingToken.address);

    action('Deploying SwappableYieldSource instance...');

    const swappableYieldSourceDeployment = await deployments.get('SwappableYieldSource');
    const swappableYieldSourceContract = (await getContractAt(
      'SwappableYieldSource',
      swappableYieldSourceDeployment.address,
      contractsOwner,
    )) as SwappableYieldSource;

    const genericProxyFactoryDeployment = await deployments.get('GenericProxyFactory');
    const genericProxyFactory = (await getContractAt(
      'GenericProxyFactory',
      genericProxyFactoryDeployment.address,
      contractsOwner,
    )) as GenericProxyFactory;

    const swappableYieldSourceInterface = new ethers.utils.Interface(
      (await artifacts.readArtifact('SwappableYieldSource')).abi,
    );

    const constructorArgs = swappableYieldSourceInterface.encodeFunctionData(
      swappableYieldSourceInterface.getFunction('initialize'),
      [mockedYieldSource.address, yieldSourceOwner.address],
    );

    const createSwappableYieldSourceResult = await genericProxyFactory.create(
      swappableYieldSourceContract.address,
      constructorArgs,
    );

    const createSwappableYieldSourceReceipt = await getTransactionReceipt(
      createSwappableYieldSourceResult.hash,
    );

    const createSwappableYieldSourceEvent = genericProxyFactory.interface.parseLog(
      createSwappableYieldSourceReceipt.logs[0],
    );

    const swappableYieldSourceAddress = createSwappableYieldSourceEvent.args.created;

    swappableYieldSource = (await getContractAt(
      'SwappableYieldSource',
      swappableYieldSourceAddress,
      contractsOwner,
    )) as SwappableYieldSource;
  });

  describe('depositToken()', () => {
    it('should return the underlying token', async () => {
      expect(await swappableYieldSource.depositToken()).to.equal(underlyingToken.address);
    });
  });
});
