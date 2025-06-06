const { Order, Cart, CancelRequest, User } = require("@models");
const mongoose = require("mongoose");
const paginate = require("@utils/pagination");
const ApiError = require("@utils/ApiError");

const orderService = {
  /**
   * Lấy danh sách đơn hàng của người dùng
   * @param {String} userId - ID của người dùng
   * @param {Object} query - Các tham số truy vấn
   * @returns {Object} - Danh sách đơn hàng và thống kê
   */
  getUserOrders: async (userId, query = {}) => {
    const { page = 1, limit = 90, status, search } = query;

    // Xây dựng điều kiện lọc
    const filter = { user: userId };
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { code: { $regex: search, $options: "i" } },
        { "shippingAddress.name": { $regex: search, $options: "i" } },
        { "shippingAddress.phone": { $regex: search, $options: "i" } },
      ];
    }

    // Sử dụng hàm phân trang
    const populate = [
      { path: "user", select: "name email" },
      {
        path: "orderItems.variant",
        select: "color product",
        populate: [
          { path: "color", select: "name code" },
          { path: "product", select: "name slug images price" },
        ],
      },
      { path: "orderItems.size", select: "value description" },
    ];

    const result = await paginate(Order, filter, {
      page,
      limit,
      populate,
    });

    // Thống kê số đơn hàng theo trạng thái
    const orderStatsAgg = await Order.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const stats = {
      pending: 0,
      confirmed: 0,
      shipping: 0,
      delivered: 0,
      cancelled: 0,
      total: 0,
    };

    orderStatsAgg.forEach(({ _id, count }) => {
      stats[_id] = count;
      stats.total += count;
    });

    return {
      orders: result.data,
      pagination: {
        page: result.currentPage,
        limit: parseInt(limit),
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.hasNextPage,
        hasPrev: result.hasPrevPage,
      },
      stats,
    };
  },

  /**
   * Lấy chi tiết đơn hàng
   * @param {String} orderId - ID của đơn hàng
   * @param {String} userId - ID của người dùng (để kiểm tra quyền truy cập)
   * @returns {Object} - Chi tiết đơn hàng
   */
  getOrderById: async (orderId, userId) => {
    // Kiểm tra đơn hàng có tồn tại không
    const order = await Order.findById(orderId)
      .populate("user", "name email avatar")
      .populate({
        path: "orderItems.variant",
        select: "color price",
        populate: [
          { path: "color", select: "name code" },
          { path: "product", select: "name slug images price description" },
        ],
      })
      .populate({
        path: "orderItems.size",
        select: "value description",
      })
      .populate("coupon", "code type value maxDiscount")
      .populate("cancelRequestId")
      .lean();

    if (!order) {
      throw new ApiError(404, "Không tìm thấy đơn hàng");
    }

    // Kiểm tra người dùng có quyền xem đơn hàng này không
    if (order.user._id.toString() !== userId) {
      throw new ApiError(403, "Bạn không có quyền xem đơn hàng này");
    }

    return order;
  },

  /**
   * Tạo đơn hàng mới từ giỏ hàng
   * @param {Object} orderData - Dữ liệu đơn hàng
   * @returns {Object} - Đơn hàng đã tạo
   */
  createOrder: async (orderData) => {
    const {
      userId,
      addressId,
      paymentMethod = "COD",
      note,
      couponCode,
    } = orderData;

    // Kiểm tra dữ liệu đầu vào
    if (!addressId) {
      throw new ApiError(400, "Vui lòng cung cấp địa chỉ giao hàng");
    }

    // Kiểm tra phương thức thanh toán hợp lệ
    if (!["COD", "VNPAY"].includes(paymentMethod)) {
      throw new ApiError(400, "Phương thức thanh toán không hợp lệ");
    }

    // Lấy địa chỉ giao hàng từ user
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "Không tìm thấy người dùng");
    }

    // Tìm địa chỉ trong danh sách địa chỉ của người dùng
    const address = user.addresses.find(
      (addr) => addr._id.toString() === addressId
    );
    if (!address) {
      throw new ApiError(404, "Không tìm thấy địa chỉ giao hàng");
    }

    // Ánh xạ từ cấu trúc địa chỉ User sang cấu trúc địa chỉ Order
    const shippingAddress = {
      name: address.fullName,
      phone: address.phone,
      province: address.province,
      district: address.district,
      ward: address.ward,
      detail: address.addressDetail,
    };

    // Lấy giỏ hàng hiện tại
    let cart = await Cart.findOne({ user: userId })
      .populate({
        path: "cartItems.variant",
        populate: { path: "product" },
      })
      .populate("cartItems.size");

    if (!cart || cart.cartItems.length === 0) {
      throw new ApiError(400, "Giỏ hàng trống, không thể tạo đơn hàng");
    }

    // Lọc ra những sản phẩm được chọn
    const selectedItems = cart.cartItems.filter((item) => item.isSelected);

    if (selectedItems.length === 0) {
      throw new ApiError(
        400,
        "Vui lòng chọn ít nhất một sản phẩm để thanh toán"
      );
    }

    console.log("Đang kiểm tra tồn kho cho các sản phẩm đã chọn...");

    // Kiểm tra trực tiếp tồn kho và chuẩn bị mảng orderItems
    const Variant = mongoose.model("Variant");
    const orderItems = [];
    const unavailableItems = [];

    for (const item of selectedItems) {
      const itemId = item._id.toString();
      const variantId =
        typeof item.variant === "object" ? item.variant._id : item.variant;
      const variant = await Variant.findById(variantId);

      if (!variant) {
        unavailableItems.push({
          productName: item.productName,
          reason: "Không tìm thấy biến thể sản phẩm",
        });
        continue;
      }

      const sizeId = typeof item.size === "object" ? item.size._id : item.size;
      const sizeInfo = variant.sizes.find(
        (s) => s.size.toString() === sizeId.toString()
      );

      console.log(`Kiểm tra sản phẩm: ${item.productName}`);
      console.log(`- Biến thể: ${variantId}`);
      console.log(`- Kích thước: ${sizeId}`);
      console.log(`- Yêu cầu số lượng: ${item.quantity}`);

      if (!sizeInfo) {
        console.log(`- Kết quả: Không tìm thấy kích thước trong biến thể`);
        unavailableItems.push({
          productName: item.productName,
          reason: "Không tìm thấy kích thước cho biến thể này",
        });
        continue;
      }

      console.log(`- Trong kho: ${sizeInfo.quantity}`);
      console.log(`- Có sẵn: ${sizeInfo.isSizeAvailable ? "Có" : "Không"}`);

      if (!sizeInfo.isSizeAvailable) {
        unavailableItems.push({
          productName: item.productName,
          reason: "Kích thước này hiện không có sẵn",
        });
        continue;
      }

      if (sizeInfo.quantity < item.quantity) {
        unavailableItems.push({
          productName: item.productName,
          reason: `Không đủ tồn kho. Hiện còn ${sizeInfo.quantity} sản phẩm.`,
        });
        continue;
      }

      // Sản phẩm có sẵn, thêm vào danh sách orderItems
      orderItems.push({
        variant: variantId,
        size: sizeId,
        productName: item.productName,
        quantity: item.quantity,
        price: item.price,
        image: item.image || "",
      });
    }

    // Nếu có sản phẩm không khả dụng
    if (unavailableItems.length > 0) {
      const errorMessage = `Một số sản phẩm không có sẵn: ${unavailableItems
        .map((item) => `${item.productName} (${item.reason})`)
        .join(", ")}`;
      throw new ApiError(400, errorMessage);
    }

    // Kiểm tra nếu không có sản phẩm nào khả dụng
    if (orderItems.length === 0) {
      throw new ApiError(
        400,
        "Không có sản phẩm nào khả dụng trong giỏ hàng. Vui lòng kiểm tra lại."
      );
    }

    // Tính tổng giá trị của các sản phẩm
    const subTotal = orderItems.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    // Xử lý mã giảm giá nếu có
    let coupon = null;
    let discount = 0;
    let couponDetail = null;

    // Chỉ xử lý mã giảm giá nếu có couponCode
    if (couponCode) {
      // Tìm mã giảm giá
      const Coupon = mongoose.model("Coupon");
      coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        status: "active",
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
        $or: [{ isPublic: true }, { users: userId }],
      });

      if (!coupon) {
        throw new ApiError(
          400,
          "Mã giảm giá không hợp lệ, đã hết hạn hoặc bạn chưa thu thập"
        );
      }

      // Kiểm tra số lần sử dụng
      if (coupon.maxUses && coupon.currentUses >= coupon.maxUses) {
        throw new ApiError(400, "Mã giảm giá đã hết lượt sử dụng");
      }

      // Kiểm tra giá trị đơn hàng tối thiểu
      if (coupon.minOrderValue && subTotal < coupon.minOrderValue) {
        throw new ApiError(
          400,
          `Giá trị đơn hàng chưa đạt tối thiểu ${coupon.minOrderValue.toLocaleString()}đ để áp dụng mã giảm giá`
        );
      }

      // Tính giảm giá
      if (coupon.type === "percent") {
        discount = (subTotal * coupon.value) / 100;
        if (coupon.maxDiscount) {
          discount = Math.min(discount, coupon.maxDiscount);
        }
      } else {
        // fixed
        discount = Math.min(coupon.value, subTotal);
      }

      // Lưu chi tiết coupon
      couponDetail = {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        maxDiscount: coupon.maxDiscount,
      };
    }

    // Tính phí vận chuyển
    const DEFAULT_SHIPPING_FEE = 30000;
    const SHIPPING_FREE_THRESHOLD = 1000000;
    const shippingFee =
      subTotal >= SHIPPING_FREE_THRESHOLD ? 0 : DEFAULT_SHIPPING_FEE;

    // Tạo đơn hàng mới
    const newOrder = new Order({
      user: userId,
      orderItems: orderItems,
      shippingAddress, // Sử dụng đối tượng shippingAddress đã được ánh xạ
      note: note || "",
      subTotal,
      discount,
      shippingFee,
      totalAfterDiscountAndShipping: subTotal - discount + shippingFee,
      status: "pending",
      payment: {
        method: paymentMethod,
        paymentStatus: "pending",
      },
      statusHistory: [
        {
          status: "pending",
          updatedAt: new Date(),
          note: "Đơn hàng được tạo",
        },
      ],
      inventoryDeducted: paymentMethod === "COD", // Chỉ đánh dấu true nếu là COD
    });

    // Nếu có coupon, lưu thông tin và tăng số lần sử dụng
    if (coupon) {
      newOrder.coupon = coupon._id;
      newOrder.couponDetail = couponDetail;

      // Tăng số lần sử dụng mã giảm giá
      coupon.currentUses += 1;
      await coupon.save();
    }

    try {
      console.log("Đang lưu đơn hàng mới...");
      // Lưu đơn hàng
      const savedOrder = await newOrder.save();
      console.log("Đã lưu đơn hàng thành công, ID:", savedOrder._id);

      // Trừ tồn kho ngay sau khi tạo đơn hàng COD thành công
      if (paymentMethod === "COD") {
        console.log("Đang trừ tồn kho cho đơn hàng COD...");
        const Variant = mongoose.model("Variant");

        for (const item of orderItems) {
          const variant = await Variant.findById(item.variant);
          if (variant) {
            const sizeIndex = variant.sizes.findIndex(
              (s) => s.size.toString() === item.size.toString()
            );

            if (sizeIndex !== -1) {
              const oldQuantity = variant.sizes[sizeIndex].quantity;
              variant.sizes[sizeIndex].quantity = Math.max(
                0,
                variant.sizes[sizeIndex].quantity - item.quantity
              );
              variant.sizes[sizeIndex].isSizeAvailable =
                variant.sizes[sizeIndex].quantity > 0;

              await variant.save();
              console.log(
                `Đã trừ ${item.quantity} sản phẩm cho variant ${variant._id}, size ${item.size}: ${oldQuantity} → ${variant.sizes[sizeIndex].quantity}`
              );
            }
          }
        }

        // Cập nhật trạng thái đã trừ tồn kho
        await Order.updateOne(
          { _id: savedOrder._id },
          { inventoryDeducted: true }
        );
        console.log("Đã cập nhật trạng thái inventoryDeducted = true");
      }

      // Start of Selection
      // Sau khi tạo đơn hàng, xóa sản phẩm đã chọn trong giỏ hàng
      const itemsToRemove = cart.cartItems.filter(
        (item) => item.isSelected && item.isAvailable
      );
      if (itemsToRemove.length > 0) {
        cart.cartItems = cart.cartItems.filter(
          (item) => !(item.isSelected && item.isAvailable)
        );
        cart.totalItems = cart.cartItems.reduce(
          (sum, item) => sum + item.quantity,
          0
        );
        cart.subTotal = cart.cartItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0
        );
        await cart.save();
        console.log(
          `Đã xóa ${itemsToRemove.length} sản phẩm đã chọn khỏi giỏ hàng`
        );
      }
      // End of Selectio

      return savedOrder;
    } catch (error) {
      console.error("Lỗi khi lưu đơn hàng:", error);
      if (error.name === "ValidationError") {
        console.error(
          "Chi tiết lỗi validation:",
          JSON.stringify(error.errors, null, 2)
        );
        console.error(
          "Dữ liệu shippingAddress:",
          JSON.stringify(shippingAddress, null, 2)
        );
      }
      throw error;
    }
  },

  /**
   * Gửi yêu cầu hủy đơn hàng
   * @param {String} orderId - ID của đơn hàng
   * @param {String} userId - ID của người dùng
   * @param {Object} cancelData - Dữ liệu hủy đơn hàng
   * @returns {Object} - Kết quả yêu cầu hủy đơn hàng
   */
  cancelOrder: async (orderId, userId, cancelData) => {
    // Kiểm tra đơn hàng
    const order = await Order.findById(orderId);
    if (!order) {
      throw new ApiError(404, "Không tìm thấy đơn hàng");
    }

    // Kiểm tra quyền hủy đơn hàng
    if (order.user.toString() !== userId) {
      throw new ApiError(403, "Bạn không có quyền hủy đơn hàng này");
    }

    // Kiểm tra trạng thái đơn hàng
    if (!["pending", "confirmed"].includes(order.status)) {
      throw new ApiError(
        400,
        "Chỉ có thể hủy đơn hàng khi đang ở trạng thái chờ xác nhận hoặc đã xác nhận"
      );
    }

    // Kiểm tra lý do hủy đơn
    const { reason } = cancelData;
    if (!reason) {
      throw new ApiError(400, "Vui lòng cung cấp lý do hủy đơn hàng");
    }

    // Tạo yêu cầu hủy đơn
    const cancelRequest = new CancelRequest({
      order: orderId,
      user: userId,
      reason,
      status: "pending",
    });

    // Lưu yêu cầu hủy
    await cancelRequest.save();

    // Nếu đơn hàng đang ở trạng thái pending, cho phép hủy ngay
    if (order.status === "pending") {
      // Cập nhật yêu cầu hủy thành đã duyệt
      await CancelRequest.updateOne(
        { _id: cancelRequest._id },
        {
          status: "approved",
          resolvedAt: new Date(),
          adminResponse: "Đơn hàng đã được chấp nhận. Hủy thành công",
        }
      );

      // Tạo bản ghi lịch sử mới
      const newHistoryEntry = {
        status: "cancelled",
        updatedAt: new Date(),
        note: `Đơn hàng bị hủy tự động. Lý do: ${reason}`,
      };

      // Cập nhật trạng thái đơn hàng KHÔNG sử dụng $push để tránh trùng lặp
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: orderId },
        {
          $set: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelReason: reason,
            cancelRequestId: cancelRequest._id,
            hasCancelRequest: false,
          },
          // Thêm vào statusHistory chỉ khi THỰC SỰ cần
          $addToSet: { statusHistory: newHistoryEntry },
        },
        { new: true }
      );

      // Kiểm tra xem có bao nhiêu bản ghi statusHistory có cùng trạng thái "cancelled"
      const cancelledEntries = updatedOrder.statusHistory.filter(
        (entry) => entry.status === "cancelled"
      );

      // Nếu có nhiều hơn một, xóa các bản ghi trùng lặp
      if (cancelledEntries.length > 1) {
        const latestCancelledEntry =
          cancelledEntries[cancelledEntries.length - 1];

        // Lọc lại mảng statusHistory, loại bỏ các bản ghi trùng lặp
        const uniqueHistory = updatedOrder.statusHistory.filter(
          (entry, index) => {
            // Giữ lại bản ghi không phải "cancelled" hoặc bản ghi "cancelled" mới nhất
            return (
              entry.status !== "cancelled" ||
              entry._id.toString() === latestCancelledEntry._id.toString()
            );
          }
        );

        // Cập nhật lại với mảng đã lọc
        await Order.updateOne(
          { _id: orderId },
          { $set: { statusHistory: uniqueHistory } }
        );
      }

      // Hoàn trả tồn kho nếu đã trừ
      if (order.inventoryDeducted) {
        console.log(
          `Đang hoàn trả tồn kho cho đơn hàng pending bị hủy: ${order.code}`
        );
        const Variant = mongoose.model("Variant");

        for (const item of order.orderItems) {
          const variant = await Variant.findById(item.variant);
          if (variant) {
            const sizeIndex = variant.sizes.findIndex(
              (s) => s.size.toString() === item.size.toString()
            );

            if (sizeIndex !== -1) {
              const oldQuantity = variant.sizes[sizeIndex].quantity;
              variant.sizes[sizeIndex].quantity += item.quantity;
              variant.sizes[sizeIndex].isSizeAvailable =
                variant.sizes[sizeIndex].quantity > 0;

              await variant.save();
              console.log(
                `Đã hoàn ${item.quantity} sản phẩm cho variant ${variant._id}, size ${item.size}: ${oldQuantity} → ${variant.sizes[sizeIndex].quantity}`
              );
            }
          }
        }

        // Đánh dấu là đã trả lại tồn kho
        await Order.updateOne({ _id: orderId }, { inventoryDeducted: false });
        console.log(
          `Đã cập nhật inventoryDeducted = false cho đơn hàng: ${order.code}`
        );
      }
    } else {
      // Nếu đơn hàng đã xác nhận, chỉ cần đánh dấu có yêu cầu hủy
      await Order.updateOne(
        { _id: orderId },
        {
          cancelRequestId: cancelRequest._id,
          hasCancelRequest: true,
        }
      );
    }

    return {
      message:
        order.status === "pending"
          ? "Đơn hàng đã được hủy thành công"
          : "Yêu cầu hủy đơn hàng đã được gửi và đang chờ xử lý",
      cancelRequest,
    };
  },

  /**
   * Lấy danh sách yêu cầu hủy đơn hàng (cho admin)
   * @param {Object} query - Các tham số truy vấn
   * @returns {Object} - Danh sách yêu cầu hủy đơn hàng
   */
  getCancelRequests: async (query = {}) => {
    const { page = 1, limit = 50, status, search } = query;

    const filter = {};

    // Lọc theo trạng thái nếu có
    if (status) {
      filter.status = status;
    }

    // Tìm kiếm
    if (search) {
      // Tìm user phù hợp với từ khóa tìm kiếm
      const User = mongoose.model("User");
      const userIds = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ],
      }).distinct("_id");

      // Tìm order phù hợp với từ khóa tìm kiếm
      const Order = mongoose.model("Order");
      const orderIds = await Order.find({
        code: { $regex: search, $options: "i" },
      }).distinct("_id");

      filter.$or = [{ user: { $in: userIds } }, { order: { $in: orderIds } }];
    }

    const populate = [
      { path: "user", select: "name email phone avatar" },
      {
        path: "order",
        select: "code status payment totalAfterDiscountAndShipping createdAt",
        populate: { path: "user", select: "name email" },
      },
      { path: "processedBy", select: "name email" },
    ];

    const result = await paginate(CancelRequest, filter, {
      page,
      limit,
      populate,
      sort: { createdAt: -1 }, // Sắp xếp theo thời gian tạo mới nhất
    });

    return {
      cancelRequests: result.data,
      pagination: {
        page: result.currentPage,
        limit: parseInt(limit),
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.hasNextPage,
        hasPrev: result.hasPrevPage,
      },
    };
  },

  /**
   * Lấy danh sách yêu cầu hủy đơn hàng của người dùng
   * @param {String} userId - ID của người dùng
   * @param {Object} query - Các tham số truy vấn
   * @returns {Object} - Danh sách yêu cầu hủy đơn hàng
   */
  getUserCancelRequests: async (userId, query = {}) => {
    const { page = 1, limit = 50, status } = query;

    const filter = { user: userId };
    if (status) {
      filter.status = status;
    }

    const populate = [
      {
        path: "order",
        select: "code status payment totalAfterDiscountAndShipping createdAt",
      },
    ];

    const result = await paginate(CancelRequest, filter, {
      page,
      limit,
      populate,
      sort: { createdAt: -1 },
    });

    return {
      cancelRequests: result.data,
      pagination: {
        page: result.currentPage,
        limit: parseInt(limit),
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.hasNextPage,
        hasPrev: result.hasPrevPage,
      },
    };
  },

  /**
   * Lấy danh sách tất cả đơn hàng (cho admin)
   * @param {Object} query - Các tham số truy vấn
   * @returns {Object} - Danh sách đơn hàng
   */
  getAllOrders: async (query = {}) => {
    const { page = 1, limit = 90, status, search } = query;

    // Xây dựng điều kiện lọc
    const filter = {};

    // Lọc theo trạng thái nếu có
    if (status) {
      filter.status = status;
    }

    // Tìm kiếm theo mã đơn hàng hoặc thông tin người dùng
    if (search) {
      const userIds = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ],
      }).distinct("_id");

      filter.$or = [
        { code: { $regex: search, $options: "i" } },
        { user: { $in: userIds } },
        { "shippingAddress.name": { $regex: search, $options: "i" } },
        { "shippingAddress.phone": { $regex: search, $options: "i" } },
      ];
    }

    // Sử dụng hàm phân trang
    const populate = [
      { path: "user", select: "name email phone" },
      {
        path: "cancelRequestId",
        select: "reason status createdAt resolvedAt adminResponse",
      },
    ];

    const result = await paginate(Order, filter, {
      page,
      limit,
      populate,
    });

    return {
      orders: result.data,
      pagination: {
        page: result.currentPage,
        limit: parseInt(limit),
        total: result.total,
        totalPages: result.totalPages,
      },
    };
  },

  /**
   * Lấy chi tiết đơn hàng (cho admin)
   * @param {String} orderId - ID của đơn hàng
   * @returns {Object} - Chi tiết đơn hàng
   */
  getOrderDetail: async (orderId) => {
    // Kiểm tra đơn hàng có tồn tại không
    const order = await Order.findById(orderId)
      .populate("user", "name email phone avatar")
      .populate({
        path: "orderItems.variant",
        select: "color price",
        populate: [
          { path: "color", select: "name code" },
          { path: "product", select: "name slug images price" },
        ],
      })
      .populate({
        path: "orderItems.size",
        select: "value description",
      })
      .populate("coupon", "code type value maxDiscount")
      .populate("cancelRequestId")
      .lean();

    if (!order) {
      throw new ApiError(404, "Không tìm thấy đơn hàng");
    }

    return order;
  },

  /**
   * Cập nhật trạng thái đơn hàng
   * @param {String} orderId - ID của đơn hàng
   * @param {Object} updateData - Dữ liệu cập nhật
   * @returns {Object} - Đơn hàng đã cập nhật
   */
  updateOrderStatus: async (orderId, updateData) => {
    const { status, note } = updateData;

    // Kiểm tra đơn hàng có tồn tại không
    const order = await Order.findById(orderId).populate("cancelRequestId");
    if (!order) {
      throw new ApiError(404, "Không tìm thấy đơn hàng");
    }

    // Kiểm tra nếu trạng thái không thay đổi
    if (order.status === status) {
      throw new ApiError(400, `Đơn hàng đã ở trạng thái ${status}`);
    }

    // Kiểm tra các trạng thái chuyển đổi hợp lệ
    const validStatusTransitions = {
      pending: ["confirmed"],
      confirmed: ["shipping"],
      shipping: ["delivered"],
      delivered: [],
      cancelled: [],
    };

    // Xử lý riêng trường hợp chuyển sang trạng thái "cancelled"
    if (status === "cancelled") {
      // Admin không thể trực tiếp hủy đơn hàng mà phải thông qua yêu cầu hủy
      if (!order.hasCancelRequest) {
        throw new ApiError(
          400,
          "Không thể hủy đơn hàng trực tiếp. Cần có yêu cầu hủy từ khách hàng."
        );
      }

      // Kiểm tra yêu cầu hủy có hợp lệ không
      if (!order.cancelRequestId) {
        throw new ApiError(
          400,
          "Không tìm thấy thông tin yêu cầu hủy đơn hàng"
        );
      }

      // Kiểm tra trạng thái của yêu cầu hủy
      const cancelRequest =
        order.cancelRequestId instanceof mongoose.Document
          ? order.cancelRequestId
          : await CancelRequest.findById(order.cancelRequestId);

      if (!cancelRequest) {
        throw new ApiError(404, "Không tìm thấy yêu cầu hủy đơn hàng");
      }

      if (cancelRequest.status !== "pending") {
        throw new ApiError(
          400,
          `Yêu cầu hủy đã được xử lý với trạng thái: ${cancelRequest.status}`
        );
      }
    }
    // Kiểm tra trạng thái chuyển đổi thông thường nếu không phải trường hợp hủy
    else if (!validStatusTransitions[order.status].includes(status)) {
      throw new ApiError(
        400,
        `Không thể chuyển từ trạng thái ${order.status} sang ${status}`
      );
    }

    // Kiểm tra thanh toán VNPAY: đảm bảo đã thanh toán trước khi chuyển sang các trạng thái tiếp theo
    if (
      order.payment.method === "VNPAY" &&
      ["confirmed", "shipping", "delivered"].includes(status) &&
      order.payment.paymentStatus !== "paid"
    ) {
      throw new ApiError(
        400,
        `Đơn hàng VNPAY chưa được thanh toán, không thể chuyển sang trạng thái ${status}`
      );
    }

    // Kiểm tra nếu đơn hàng có yêu cầu hủy đang chờ xử lý và đang cố gắng chuyển sang trạng thái khác
    if (order.hasCancelRequest && status !== "cancelled") {
      throw new ApiError(
        400,
        "Đơn hàng có yêu cầu hủy đang chờ xử lý, phải xử lý yêu cầu hủy trước khi thay đổi trạng thái"
      );
    }

    // Lưu trạng thái trước khi cập nhật
    const previousStatus = order.status;

    // Cập nhật trạng thái đơn hàng
    order.status = status;

    // Thêm vào lịch sử trạng thái
    order.statusHistory.push({
      status,
      note: note || "",
      updatedAt: new Date(),
      // Có thể thêm updatedBy nếu có thông tin người cập nhật
    });

    // Cập nhật thông tin thêm tùy thuộc vào trạng thái
    switch (status) {
      case "confirmed":
        order.confirmedAt = new Date();
        break;
      case "shipping":
        order.shippingAt = new Date();
        break;
      case "delivered":
        order.deliveredAt = new Date();
        // Cập nhật trạng thái thanh toán cho COD
        if (
          order.payment.method === "COD" &&
          order.payment.paymentStatus !== "paid"
        ) {
          order.payment.paymentStatus = "paid";
          order.payment.paidAt = new Date();
        }
        break;
      case "cancelled":
        order.cancelledAt = new Date();

        // Nếu đơn hàng có yêu cầu hủy, đánh dấu đã xử lý
        if (order.cancelRequestId) {
          // Cập nhật cancel request
          await CancelRequest.findByIdAndUpdate(order.cancelRequestId, {
            status: "approved",
            resolvedAt: new Date(),
            adminResponse: note || "Yêu cầu hủy đơn hàng được chấp nhận",
          });
          order.hasCancelRequest = false;
          order.cancelReason =
            order.cancelRequestId.reason ||
            "Đã chấp nhận yêu cầu hủy từ khách hàng";
        }
        break;
    }

    // Lưu đơn hàng
    await order.save();

    return {
      success: true,
      message: `Đã cập nhật trạng thái đơn hàng từ ${previousStatus} sang ${status}`,
      data: {
        orderId: order._id,
        code: order.code,
        previousStatus,
        currentStatus: status,
        updatedAt: new Date(),
      },
    };
  },

  /**
   * Xử lý yêu cầu hủy đơn hàng cho admin
   * @param {String} requestId - ID của yêu cầu hủy đơn hàng
   * @param {Object} updateData - Dữ liệu cập nhật
   * @returns {Object} - Kết quả xử lý
   */
  processCancelRequest: async (requestId, updateData) => {
    const { status, adminResponse, adminId } = updateData;

    // Kiểm tra yêu cầu hủy có tồn tại không
    const cancelRequest = await CancelRequest.findById(requestId);
    if (!cancelRequest) {
      throw new ApiError(404, "Không tìm thấy yêu cầu hủy đơn hàng");
    }

    // Kiểm tra trạng thái cập nhật hợp lệ
    if (!["approved", "rejected"].includes(status)) {
      throw new ApiError(400, "Trạng thái không hợp lệ");
    }

    // Kiểm tra nếu đang thay đổi sang trạng thái giống với trạng thái hiện tại
    if (cancelRequest.status === status) {
      throw new ApiError(400, `Yêu cầu hủy đã ở trạng thái ${status}`);
    }

    // Tìm đơn hàng liên quan
    const order = await Order.findById(cancelRequest.order);
    if (!order) {
      throw new ApiError(404, "Không tìm thấy đơn hàng liên quan");
    }

    // Lưu trạng thái trước đó để xử lý logic
    const previousStatus = cancelRequest.status;
    const isChangingDecision = previousStatus !== "pending";
    const wasApproved = previousStatus === "approved";
    const wasRejected = previousStatus === "rejected";

    // Xử lý logic khi thay đổi từ approved sang rejected
    if (wasApproved && status === "rejected") {
      // Kiểm tra nếu đơn hàng đã bị hủy do yêu cầu hủy trước đó
      if (
        order.status === "cancelled" &&
        order.cancelRequestId?.toString() === requestId
      ) {
        // Kiểm tra nếu đơn hàng đã bị hủy quá lâu (ví dụ 24 giờ) thì không cho phép khôi phục
        const cancelledTime = new Date(order.cancelledAt).getTime();
        const currentTime = new Date().getTime();
        const hoursSinceCancelled =
          (currentTime - cancelledTime) / (1000 * 60 * 60);

        if (hoursSinceCancelled > 24) {
          throw new ApiError(
            400,
            "Không thể từ chối yêu cầu hủy vì đơn hàng đã bị hủy quá 24 giờ"
          );
        }

        // Khôi phục trạng thái đơn hàng về trạng thái trước khi bị hủy
        // Tìm trạng thái trước đó trong lịch sử
        const statusHistoryReversed = [...order.statusHistory].reverse();
        let previousOrderStatus = "pending"; // Mặc định

        for (let i = 1; i < statusHistoryReversed.length; i++) {
          if (statusHistoryReversed[i].status !== "cancelled") {
            previousOrderStatus = statusHistoryReversed[i].status;
            break;
          }
        }

        order.status = previousOrderStatus;
        order.cancelReason = "";
        order.cancelledAt = null;
        order.statusHistory.push({
          status: previousOrderStatus,
          note: `Đơn hàng được khôi phục sau khi từ chối yêu cầu hủy`,
          updatedAt: new Date(),
          updatedBy: adminId,
        });
      } else {
        // Nếu đơn hàng không ở trạng thái cancelled hoặc đã bị hủy bởi lý do khác
        throw new ApiError(
          400,
          "Không thể từ chối yêu cầu hủy vì đơn hàng không ở trạng thái bị hủy hoặc đã bị hủy bởi lý do khác"
        );
      }
    }
    // Xử lý logic khi thay đổi từ rejected sang approved
    else if (wasRejected && status === "approved") {
      // Kiểm tra xem đơn hàng có còn ở trạng thái có thể hủy không
      if (!["pending", "confirmed"].includes(order.status)) {
        throw new ApiError(
          400,
          `Không thể chấp nhận yêu cầu hủy vì đơn hàng hiện đang ở trạng thái ${order.status}`
        );
      }

      // Tiến hành hủy đơn hàng
      order.status = "cancelled";
      order.cancelledAt = new Date();
      order.cancelReason = cancelRequest.reason;
      order.statusHistory.push({
        status: "cancelled",
        note: `Đơn hàng bị hủy theo yêu cầu. Lý do: ${cancelRequest.reason}`,
        updatedAt: new Date(),
        updatedBy: adminId,
      });
    }
    // Xử lý yêu cầu hủy lần đầu (từ pending)
    else {
      // Xử lý khi chấp nhận yêu cầu hủy
      if (status === "approved") {
        // Kiểm tra nếu đơn hàng không còn ở trạng thái có thể hủy
        if (!["pending", "confirmed"].includes(order.status)) {
          throw new ApiError(
            400,
            `Đơn hàng hiện đang ở trạng thái ${order.status}, không thể hủy`
          );
        }

        // Cập nhật đơn hàng thành "cancelled"
        order.status = "cancelled";
        order.cancelledAt = new Date();
        order.cancelReason = cancelRequest.reason;
        order.statusHistory.push({
          status: "cancelled",
          note: `Đơn hàng bị hủy theo yêu cầu. Lý do: ${cancelRequest.reason}`,
          updatedAt: new Date(),
          updatedBy: adminId,
        });
      }
    }

    // Cập nhật trạng thái hasCancelRequest của đơn hàng
    order.hasCancelRequest = false;
    await order.save();

    // Cập nhật yêu cầu hủy
    cancelRequest.status = status;
    cancelRequest.adminResponse = adminResponse || "";
    cancelRequest.resolvedAt = new Date();
    cancelRequest.processedBy = adminId;

    // Lưu yêu cầu hủy
    await cancelRequest.save();

    return {
      success: true,
      message:
        status === "approved"
          ? wasRejected
            ? "Đã thay đổi quyết định và chấp nhận yêu cầu hủy đơn hàng"
            : "Đã chấp nhận yêu cầu hủy đơn hàng"
          : wasApproved
          ? "Đã thay đổi quyết định và từ chối yêu cầu hủy đơn hàng"
          : "Đã từ chối yêu cầu hủy đơn hàng",
      data: {
        cancelRequest: {
          _id: cancelRequest._id,
          status: cancelRequest.status,
          previousStatus: previousStatus,
          decisionChanged: isChangingDecision,
          resolvedAt: cancelRequest.resolvedAt,
          adminResponse: cancelRequest.adminResponse,
        },
        order: {
          _id: order._id,
          code: order.code,
          status: order.status,
          previouslyHadCancelRequest: isChangingDecision,
        },
      },
    };
  },
};

module.exports = orderService;
