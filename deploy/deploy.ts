import { Contract, ContractFactory } from 'ethers';
import { getChainByChainId } from 'evm-chains';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction, DeployResult } from 'hardhat-deploy/types';

import { action, alert, info, success } from '../scripts/helpers';
import { AAVE_DAI_YIELD_SOURCE_KOVAN } from '../Constant';

const displayResult = (name: string, result: DeployResult) => {
  if (!result.newlyDeployed) {
    alert(`Re-used existing ${name} at ${result.address}`);
  } else {
    success(`${name} deployed at ${result.address}`);
  }
};

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  info('\n~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
  info('PoolTogether Swappable Yield Source - Deploy Script');
  info('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\n');

  const { getNamedAccounts, deployments, getChainId, ethers } = hre;
  const { deploy } = deployments;

  let { deployer, multisig } = await getNamedAccounts();

  const chainId = parseInt(await getChainId());
  const network = getChainByChainId(chainId).network;

  // 31337 is unit testing, 1337 is for coverage
  const isTestEnvironment = chainId === 31337 || chainId === 1337;

  info(`Network: ${network} (${isTestEnvironment ? 'local' : 'remote'})`);
  info(`Deployer: ${deployer}`);

  if (!multisig) {
    alert(
      `Multisig address not defined for network ${network}, falling back to deployer: ${deployer}`,
    );
    multisig = deployer;
  } else {
    info(`Multisig: ${multisig}`);
  }

  action(`Deploying SwappableYieldSource...`);
  const swappableYieldSourceResult: DeployResult = await deploy('SwappableYieldSource', {
    from: deployer,
    skipIfAlreadyDeployed: true,
  });

  displayResult('SwappableYieldSource', swappableYieldSourceResult);

  const swappableYieldSourceContract = await ethers.getContractAt(
    'SwappableYieldSource',
    swappableYieldSourceResult.address,
  );

  let proxyFactoryContractFactory: ContractFactory;
  let proxyFactoryContract: Contract;

  if (isTestEnvironment) {
    info(`TestEnvironment detected, deploying a local GenericProxyFactory`);
    proxyFactoryContractFactory = await ethers.getContractFactory('GenericProxyFactory');
    proxyFactoryContract = await proxyFactoryContractFactory.deploy();
    success(`Deployed a local GenericProxyFactory at ${proxyFactoryContract.address}`);
  } else {
    let { genericProxyFactory } = await getNamedAccounts();
    proxyFactoryContract = await ethers.getContractAt('GenericProxyFactory', genericProxyFactory);
    info(`GenericProxyFactory for ${network} at ${proxyFactoryContract.address}`);
  }

  action(`Deploying SwappableYieldSource...`);

  const swappableYieldSourceInterface = new ethers.utils.Interface(
    (await hre.artifacts.readArtifact('SwappableYieldSource')).abi,
  );

  const constructorArgs: string = swappableYieldSourceInterface.encodeFunctionData(
    swappableYieldSourceInterface.getFunction('initialize'),
    [AAVE_DAI_YIELD_SOURCE_KOVAN, multisig],
  );

  const createSwappableYieldSourceResult = await proxyFactoryContract.create(
    swappableYieldSourceContract.address,
    constructorArgs,
  );

  console.log('createSwappableYieldSourceResult', createSwappableYieldSourceResult);
};

export default deployFunction;
