class AccountInputError extends Error {}

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_PASSWORD_BYTES = 72;

// A short local deny-list catches the worst passwords without an external
// service. It is intentionally small; the length requirement carries most of
// the weight.
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyui',
  'qwerty123',
  'iloveyou',
  'letmein1',
  'admin123',
  'welcome1',
  'abc12345',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'dragon123',
]);

function normalizeUsername(value) {
  if (typeof value !== 'string') {
    throw new AccountInputError('Username is required');
  }

  const username = value.trim();
  if (username.length < 3 || username.length > 20) {
    throw new AccountInputError('Username must be 3-20 characters');
  }

  return username;
}

function validateNewPassword(value) {
  if (typeof value !== 'string') {
    throw new AccountInputError('Password is required');
  }
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    throw new AccountInputError(
      `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`
    );
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new AccountInputError(`Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`);
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    throw new AccountInputError('Password is too common; choose a stronger password');
  }

  return value;
}

function validateConfirmedPassword(newPassword, confirmPassword) {
  const password = validateNewPassword(newPassword);
  if (password !== confirmPassword) {
    throw new AccountInputError('New passwords do not match');
  }
  return password;
}

function validatePasswordChange(currentPassword, newPassword, confirmPassword) {
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    throw new AccountInputError('Current password is required');
  }
  return { currentPassword, newPassword: validateConfirmedPassword(newPassword, confirmPassword) };
}

module.exports = {
  AccountInputError,
  normalizeUsername,
  validateNewPassword,
  validateConfirmedPassword,
  validatePasswordChange,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
};
