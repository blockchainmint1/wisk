// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Wrapped Iskander Coin (wISK)
/// @notice 1:1 ERC-20 representation of native ISK held by the wISK bridge.
///
/// Supply model: mint-on-wrap / burn-on-unwrap. Total supply is never
/// pre-minted; it is always equal to the amount of native ISK the bridge
/// holds in reserve. There is no unissued float sitting in a hot wallet.
///
///   wrap:   user sends ISK -> bridge -> mint(user, amount)
///   unwrap: user sends wISK -> bridge burns it -> bridge releases ISK
///
/// Decimals are 8 to match native ISK (IskanderCore, Bitcoin-derived).
contract WrappedISK is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Emitted when the bridge mints against a native ISK deposit.
    /// @param iskTxid The native-chain txid that funded this mint.
    event Wrapped(address indexed to, uint256 amount, string iskTxid);

    /// @notice Emitted when the bridge burns wISK to release native ISK.
    /// @param iskAddress The native ISK address the reserve is released to.
    event Unwrapped(address indexed from, uint256 amount, string iskAddress);

    constructor(address admin) ERC20("Wrapped Iskander Coin", "wISK") ERC20Permit("Wrapped Iskander Coin") {
        require(admin != address(0), "wISK: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(BURNER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @dev Native ISK uses 8 decimals; keep the wrapper 1:1 at the base-unit level.
    function decimals() public pure override returns (uint8) {
        return 8;
    }

    // ---------------------------------------------------------------- mint

    /// @notice Mint wISK against a confirmed native ISK deposit.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Mint and record the funding native-chain txid on-chain.
    function mintWrapped(address to, uint256 amount, string calldata iskTxid)
        external
        onlyRole(MINTER_ROLE)
    {
        _mint(to, amount);
        emit Wrapped(to, amount, iskTxid);
    }

    // ---------------------------------------------------------------- burn

    /// @notice Burn wISK the bridge already holds and record the ISK payout target.
    function burnUnwrapped(uint256 amount, string calldata iskAddress)
        external
        onlyRole(BURNER_ROLE)
    {
        _burn(msg.sender, amount);
        emit Unwrapped(msg.sender, amount, iskAddress);
    }

    /// @notice Burn from an account that has approved the bridge.
    /// @dev Requires allowance; the bridge cannot burn arbitrary balances.
    function burnFromWithMemo(address from, uint256 amount, string calldata iskAddress)
        external
        onlyRole(BURNER_ROLE)
    {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        emit Unwrapped(from, amount, iskAddress);
    }

    // -------------------------------------------------------------- pausing

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------- plumbing

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
