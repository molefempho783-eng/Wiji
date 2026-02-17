// utils/cryptoConstants.ts
// Polygon network and token configuration

export const POLYGON_CHAIN_ID = 137; // Polygon Mainnet
export const POLYGON_TESTNET_CHAIN_ID = 80002; // Amoy Testnet (replaced Mumbai)

// Use testnet for development, mainnet for production
export const IS_TESTNET = __DEV__ || process.env.NODE_ENV !== 'production';
export const CURRENT_CHAIN_ID = IS_TESTNET ? POLYGON_TESTNET_CHAIN_ID : POLYGON_CHAIN_ID;

// Polygon RPC endpoints
export const POLYGON_RPC_URL = IS_TESTNET
  ? 'https://rpc-amoy.polygon.technology' // Amoy testnet
  : 'https://polygon-rpc.com'; // Mainnet

// Token contract addresses on Polygon
export const TOKEN_ADDRESSES = {
  // Polygon Mainnet
  MAINNET: {
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
  // Polygon Amoy Testnet (replaced Mumbai)
  TESTNET: {
    USDC: '0xF3A9e0B4a509e42803Ba388fC4Dc91A6C63BeFfB', // Official USDC on Amoy
    USDT: '0x2B7a90F1A001AaC943C68428B16E4da4E15DA469', // Official USDT on Amoy
    WMATIC: '0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889', // WMATIC on Amoy
  },
};

export const getTokenAddress = (token: 'USDC' | 'USDT'): string => {
  const network = IS_TESTNET ? TOKEN_ADDRESSES.TESTNET : TOKEN_ADDRESSES.MAINNET;
  return network[token];
};

// Token decimals
export const TOKEN_DECIMALS = {
  USDC: 6,
  USDT: 6,
};

// ERC20 ABI for transfers
export const ERC20_ABI = [
  // Read functions
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  // Write functions
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  // Events
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// Polygon network info for MetaMask
export const POLYGON_NETWORK = {
  chainId: `0x${CURRENT_CHAIN_ID.toString(16)}`,
  chainName: IS_TESTNET ? 'Polygon Amoy' : 'Polygon Mainnet',
  nativeCurrency: {
    name: 'MATIC',
    symbol: 'MATIC',
    decimals: 18,
  },
  rpcUrls: [POLYGON_RPC_URL],
  blockExplorerUrls: [
    IS_TESTNET ? 'https://amoy.polygonscan.com' : 'https://polygonscan.com',
  ],
};

