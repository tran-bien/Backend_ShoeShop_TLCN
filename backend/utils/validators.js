// Logic cho kiểm tra email
const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

// Logic cho kiểm tra số điện thoại
const isValidPhoneNumber = (phone) => {
  const re = /^\d{10}$/; // Ví dụ: kiểm tra số điện thoại 10 chữ số
  return re.test(String(phone));
};

// Logic cho kiểm tra mật khẩu
const checkPasswordRequirements = (password) => {
  const minLength = 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  return password.length >= minLength && hasLetter && hasNumber;
};

module.exports = {
  isValidEmail,
  isValidPhoneNumber,
  checkPasswordRequirements,
};
