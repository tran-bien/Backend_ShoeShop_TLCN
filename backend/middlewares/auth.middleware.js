const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Session = require("../models/session.model");
const asyncHandler = require("express-async-handler");
const rateLimit = require("express-rate-limit");

// Bảo vệ các route yêu cầu đăng nhập
exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  // Debug logs
  console.log("Authorization header:", req.headers.authorization);

  // Lấy token từ Authorization header hoặc từ cookie
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    // Token từ Authorization header
    token = req.headers.authorization.split(" ")[1];
    console.log("Extracted token from header:", token);
  } else if (req.cookies && req.cookies.token) {
    // Token từ cookie
    token = req.cookies.token;
    console.log("Extracted token from cookie:", token);
  }

  if (!token) {
    console.log("No token found in request");
    return res.status(401).json({
      success: false,
      message: "Vui lòng đăng nhập để truy cập",
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded token:", decoded);

    // Lấy thông tin user
    const user = await User.findById(decoded.id);

    if (!user) {
      console.log("User not found for id:", decoded.id);
      return res.status(401).json({
        success: false,
        message: "Người dùng không tồn tại",
      });
    }

    // Kiểm tra tài khoản có hoạt động không
    if (!user.isActive) {
      console.log("User account is inactive:", decoded.id);
      return res.status(401).json({
        success: false,
        message: "Tài khoản đã bị vô hiệu hóa",
      });
    }

    // Tìm session hiện tại
    const session = await Session.findOne({
      userId: user._id,
      token: token,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      console.log("No active session found for token");

      // Kiểm tra xem có phải session đã hết hạn
      const expiredSession = await Session.findOne({
        userId: user._id,
        token: token,
      });

      if (expiredSession) {
        if (!expiredSession.isActive) {
          return res.status(401).json({
            success: false,
            message: "Phiên đăng nhập đã bị đăng xuất, vui lòng đăng nhập lại",
          });
        } else if (expiredSession.expiresAt <= new Date()) {
          return res.status(401).json({
            success: false,
            message: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
          });
        }
      }

      return res.status(401).json({
        success: false,
        message: "Không tìm thấy phiên đăng nhập hợp lệ",
      });
    }

    // Cập nhật thời gian hoạt động mới nhất
    session.lastActive = new Date();
    await session.save();

    // Gắn thông tin user vào request
    req.user = user;
    req.session = session;
    console.log("User authenticated:", user.email);

    next();
  } catch (error) {
    console.error("Error in auth middleware:", error.message);
    return res.status(401).json({
      success: false,
      message: "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại",
    });
  }
});

// Phân quyền truy cập
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền truy cập vào tài nguyên này",
      });
    }
    next();
  };
};

// Middleware cho Admin
exports.admin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(403);
    throw new Error("Bạn không có quyền admin");
  }
};

// Nên thêm rate limiting cho API login
// Hiện tại chưa có bảo vệ brute force attack
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 5, // 5 lần thử
});
