const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AccountInputError,
  normalizeUsername,
  validateNewPassword,
  validatePasswordChange,
} = require('../src/services/account_validation');

test('normalizes usernames and enforces username length', () => {
  assert.equal(normalizeUsername('  player-one  '), 'player-one');
  assert.throws(() => normalizeUsername('ab'), AccountInputError);
  assert.throws(() => normalizeUsername('x'.repeat(21)), /3-20 characters/);
  assert.throws(() => normalizeUsername(null), /required/);
});

test('validates new password length', () => {
  assert.equal(validateNewPassword('secret-passphrase'), 'secret-passphrase');
  assert.throws(() => validateNewPassword('short12'), /8-128 characters/);
  assert.throws(() => validateNewPassword('x'.repeat(129)), /8-128 characters/);
});

test('rejects new passwords that bcrypt would truncate by UTF-8 byte length', () => {
  assert.equal(validateNewPassword('a'.repeat(72)), 'a'.repeat(72));
  assert.throws(() => validateNewPassword('a'.repeat(73)), /72 UTF-8 bytes/);
  assert.equal(validateNewPassword('密'.repeat(24)), '密'.repeat(24));
  assert.throws(() => validateNewPassword('密'.repeat(25)), /72 UTF-8 bytes/);
  assert.equal(validateNewPassword('😀'.repeat(18)), '😀'.repeat(18));
  assert.throws(() => validateNewPassword('😀'.repeat(19)), /72 UTF-8 bytes/);
  assert.equal(validatePasswordChange('a'.repeat(100), 'new-password', 'new-password').currentPassword.length, 100);
});

test('rejects the most common passwords', () => {
  assert.throws(() => validateNewPassword('password'), /too common/);
  assert.throws(() => validateNewPassword('Password123'), /too common/);
  assert.equal(validateNewPassword('correct-horse-battery'), 'correct-horse-battery');
});

test('requires the current password and matching new passwords', () => {
  assert.deepEqual(
    validatePasswordChange('old-password', 'new-password', 'new-password'),
    { currentPassword: 'old-password', newPassword: 'new-password' }
  );
  assert.throws(
    () => validatePasswordChange('', 'new-password', 'new-password'),
    /Current password is required/
  );
  assert.throws(
    () => validatePasswordChange('old-password', 'new-password', 'different'),
    /do not match/
  );
});
