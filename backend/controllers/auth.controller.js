const asyncHandler = require("express-async-handler");
const LoginHistory = require("../models/login.history.model");
const emailUtils = require("../utils/email");
const authService = require("../services/auth.service");
const User = require("../models/user.model");
const { isValidEmail } = require("../utils/validators");

// Đăng ký người dùng
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  // Kiểm tra thông tin đầu vào
  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng cung cấp đầy đủ thông tin",
    });
  }

  // Kiểm tra xem email đã tồn tại chưa
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    // Thay đổi logic ở đây
    return res.status(400).json({
      success: false,
      message: "Email đã tồn tại! Vui lòng sử dụng email khác.",
    });
  }

  // Gọi service để đăng ký người dùng mới
  try {
    const user = await authService.registerUser({
      name,
      email,
      password,
    });

    // Gửi mã OTP đến email
    await emailUtils.sendVerificationEmail(
      user.email,
      user.name,
      user.otp.code
    );

    res.status(201).json({
      success: true,
      message: "Đăng ký thành công! Mã OTP đã được gửi đến email của bạn.",
      // otp: user.otp.code,
    });
  } catch (error) {
    console.error("Lỗi đăng ký:", error);
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

// Xác nhận OTP
exports.verifyOTP = asyncHandler(async (req, res) => {
  const { userId, email, otp } = req.body;

  // Kiểm tra đầu vào
  if (!otp || (!userId && !email)) {
    return res.status(400).json({
      success: false,
      message: !otp
        ? "Vui lòng cung cấp mã OTP"
        : "Vui lòng cung cấp userId hoặc email",
    });
  }

  try {
    // Sử dụng authService để xác thực OTP
    const result = await authService.verifyOTP({ userId, email, otp });

    // Nếu xác thực thành công, trả về token và thông tin người dùng
    res.status(200).json({
      success: true,
      message: "Xác thực thành công!",
      token: result.token,
      refreshToken: result.refreshToken,
      user: {
        _id: result.user._id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
      },
    });
  } catch (error) {
    console.error(`Lỗi xác thực OTP: ${error.message}`);

    // Kiểm tra lỗi cụ thể để trả về thông báo phù hợp
    if (error.message === "Người dùng không tồn tại") {
      return res.status(400).json({
        success: false,
        message: "Email không hợp lệ",
      });
    } else if (error.message === "Mã OTP không hợp lệ") {
      return res.status(400).json({
        success: false,
        message: "Mã OTP không hợp lệ",
      });
    } else if (error.message === "Mã OTP đã hết hạn") {
      return res.status(400).json({
        success: false,
        message: "Mã OTP đã hết hạn",
      });
    }

    // Nếu không phải lỗi cụ thể, trả về thông báo chung
    res.status(400).json({
      success: false,
      message: "Xác thực thất bại",
    });
  }
});

// Đăng nhập
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Kiểm tra email và mật khẩu
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng cung cấp email và mật khẩu",
    });
  }

  // Kiểm tra định dạng email
  if (!isValidEmail(email)) {
    // Lưu lịch sử đăng nhập thất bại
    try {
      await LoginHistory.create({
        userId: null,
        status: "failed",
        reason: "Email không đúng định dạng",
        ipAddress: req.ip || "Unknown",
        userAgent: req.headers["user-agent"] || "Unknown",
      });
    } catch (error) {
      console.error("Lỗi khi lưu lịch sử đăng nhập:", error.message);
    }

    return res.status(400).json({
      success: false,
      message: "Email không đúng định dạng",
    });
  }

  try {
    // Sử dụng authService để đăng nhập
    const userData = await authService.loginUser(email, password, req);

    // Kiểm tra xem người dùng đã xác thực chưa
    if (!userData.isVerified) {
      // Gọi service resendOTP để gửi mã OTP mới
      await authService.resendOTP(userData.email);
      console.log(`Mã OTP mới đã được gửi đến email: ${userData.email}`);

      return res.status(200).json({
        success: false,
        message:
          "Tài khoản chưa được xác thực! Mã OTP mới đã được gửi đến email của bạn.",
      });
    }

    res.json({
      success: true,
      message: "Đăng nhập thành công",
      token: userData.token,
      refreshToken: userData.refreshToken,
      user: {
        _id: userData._id,
        name: userData.name,
        email: userData.email,
        phone: userData.phone,
        role: userData.role,
        isVerified: userData.isVerified,
        image: userData.image,
      },
    });
  } catch (error) {
    // Lưu lịch sử đăng nhập thất bại
    try {
      await LoginHistory.create({
        userId: null,
        status: "failed",
        reason: error.message,
        ipAddress: req.ip || "Unknown",
        userAgent: req.headers["user-agent"] || "Unknown",
      });
    } catch (historyError) {
      console.error("Lỗi khi lưu lịch sử đăng nhập:", historyError.message);
    }

    res.status(401).json({
      success: false,
      message: error.message || "Đăng nhập thất bại. Vui lòng thử lại.",
    });
  }
});

// Thêm endpoint để làm mới token
exports.refreshToken = asyncHandler(async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res
        .status(401)
        .json({ success: false, message: "Refresh token không hợp lệ" });
    }

    // Sử dụng authService để làm mới token
    const result = await authService.refreshToken(refreshToken, req);

    res.json({
      success: true,
      accessToken: result.token,
    });
  } catch (error) {
    res.status(403).json({
      success: false,
      message: error.message || "Refresh token không hợp lệ",
    });
  }
});

// Quên mật khẩu
exports.forgotPassword = asyncHandler(async (req, res) => {
  try {
    const { email } = req.body;

    // Kiểm tra định dạng email
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Email không hợp lệ hoặc không đúng định dạng",
      });
    }

    // Sử dụng authService để xử lý quên mật khẩu
    const result = await authService.forgotPassword(email);

    // Gửi email đặt lại mật khẩu
    await emailUtils.sendPasswordResetEmail(
      result.user.email,
      result.user.name,
      result.resetToken
    );

    // Không trả về token trong response để đảm bảo an toàn
    res.status(200).json({
      success: true,
      message: "Email hướng dẫn đặt lại mật khẩu đã được gửi!",
    });
  } catch (error) {
    // Không tiết lộ thông tin cụ thể về lỗi
    console.error(`Lỗi quên mật khẩu: ${error.message}`);
    res.status(error.statusCode || 500).json({
      success: false,
      message:
        "Nếu email tồn tại trong hệ thống, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu",
    });
  }
});

// Đặt lại mật khẩu
exports.resetPassword = asyncHandler(async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    // Kiểm tra đầu vào
    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng cung cấp token và mật khẩu mới",
      });
    }

    // Kiểm tra mật khẩu và xác nhận mật khẩu
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Mật khẩu và xác nhận mật khẩu không khớp",
      });
    }

    // Sử dụng authService để đặt lại mật khẩu
    await authService.resetPassword(token, password);

    res.status(200).json({
      success: true,
      message: "Mật khẩu đã được đặt lại thành công!",
    });
  } catch (error) {
    console.error(`Lỗi đặt lại mật khẩu: ${error.message}`);
    res.status(400).json({
      success: false,
      message: "Token không hợp lệ hoặc đã hết hạn",
    });
  }
});

// Đổi mật khẩu
exports.changePassword = asyncHandler(async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Kiểm tra đầu vào
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng cung cấp mật khẩu hiện tại và mật khẩu mới",
      });
    }

    // Kiểm tra mật khẩu mới và xác nhận mật khẩu
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Mật khẩu mới và xác nhận mật khẩu không khớp",
      });
    }

    // Sử dụng authService để đổi mật khẩu
    await authService.changePassword(
      req.user._id,
      currentPassword,
      newPassword
    );

    // Đăng xuất khỏi các phiên khác để đảm bảo an toàn
    await authService.logoutAllOtherSessions(req.user._id, req.session?._id);

    res.status(200).json({
      success: true,
      message:
        "Mật khẩu đã được thay đổi thành công! Các phiên đăng nhập khác đã bị đăng xuất.",
    });
  } catch (error) {
    console.error(`Lỗi đổi mật khẩu: ${error.message}`);
    res.status(401).json({
      success: false,
      message: error.message || "Không thể thay đổi mật khẩu",
    });
  }
});

// Lấy danh sách phiên đăng nhập hiện tại
exports.getCurrentSessions = asyncHandler(async (req, res) => {
  try {
    const sessions = await authService.getCurrentSessions(
      req.user._id,
      req.session._id
    );

    res.json({
      success: true,
      sessions: sessions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách phiên đăng nhập",
      error: error.message,
    });
  }
});

// Đăng xuất khỏi phiên cụ thể
exports.logoutSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  // Kiểm tra sessionId
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      message: "Vui lòng cung cấp ID phiên đăng nhập",
    });
  }

  try {
    // Sử dụng authService để đăng xuất khỏi phiên
    const result = await authService.logoutSession(sessionId, req.user._id);

    res.json({
      success: true,
      message: result.message,
      currentSession: result.isCurrentSession,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Lỗi khi đăng xuất khỏi phiên đăng nhập",
    });
  }
});

// Đăng xuất khỏi tất cả phiên trừ phiên hiện tại
exports.logoutAllOtherSessions = asyncHandler(async (req, res) => {
  try {
    // Sử dụng authService để đăng xuất khỏi tất cả phiên khác
    await authService.logoutAll(req.user._id);

    res.json({
      success: true,
      message: "Đã đăng xuất khỏi tất cả các thiết bị khác",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi khi đăng xuất khỏi các thiết bị khác",
      error: error.message,
    });
  }
});

// Đăng xuất
exports.logout = asyncHandler(async (req, res) => {
  try {
    // Lấy token từ header
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Không có token, không thể đăng xuất",
      });
    }

    // Sử dụng authService để đăng xuất
    await authService.logout(req.user._id, token);

    res.status(200).json({
      success: true,
      message: "Đăng xuất thành công",
    });
  } catch (error) {
    console.error(`Lỗi đăng xuất: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Lỗi khi đăng xuất",
    });
  }
});
