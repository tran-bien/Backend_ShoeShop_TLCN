const { Category, Product, Variant } = require("@models");
const paginate = require("@utils/pagination");

const categoryService = {
  // === ADMIN API METHODS ===

  /**
   * [ADMIN] Lấy tất cả category (bao gồm cả inactive)
   */
  getAdminAllCategories: async (query) => {
    const { page = 1, limit = 10, name, isActive, sort } = query;
    const filter = { deletedAt: null }; // Mặc định chỉ lấy các category chưa xóa

    if (name) {
      filter.name = { $regex: name, $options: "i" };
    }

    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const options = {
      page,
      limit,
      sort: sort ? JSON.parse(sort) : { createdAt: -1 },
    };

    return await paginate(Category, filter, options);
  },

  /**
   * [ADMIN] Lấy category theo ID (bao gồm cả inactive và đã xóa)
   */
  getAdminCategoryById: async (categoryId) => {
    // Sử dụng setOptions để bao gồm cả category đã xóa
    const category = await Category.findById(categoryId).setOptions({
      includeDeleted: true,
    });

    if (!category) {
      throw new Error("Không tìm thấy danh mục");
    }

    return category;
  },

  /**
   * [ADMIN] Lấy danh sách category đã xóa mềm
   */
  getDeletedCategories: async (query) => {
    try {
      const { page = 1, limit = 10, name, sort } = query;

      // Chuẩn bị filter
      let filter = {};

      if (name) {
        filter.name = { $regex: name, $options: "i" };
      }

      // Sử dụng phương thức cải tiến findDeleted
      const sortOption = sort ? JSON.parse(sort) : { deletedAt: -1 };

      // Lấy danh sách category đã xóa với phân trang
      const categories = await Category.findDeleted(filter, {
        page,
        limit,
        sort: sortOption,
      });

      // Đếm tổng số category đã xóa
      const totalItems = await Category.countDeleted(filter);
      const totalPages = Math.ceil(totalItems / parseInt(limit));

      return {
        success: true,
        data: categories,
        pagination: {
          totalItems,
          currentPage: parseInt(page),
          pageSize: parseInt(limit),
          totalPages,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1,
        },
      };
    } catch (error) {
      console.error("Lỗi khi lấy danh sách category đã xóa:", error);
      throw new Error("Không thể lấy danh sách danh mục đã xóa");
    }
  },

  // === PUBLIC API METHODS ===

  /**
   * [PUBLIC] Lấy tất cả category (chỉ active và chưa xóa)
   */
  getPublicAllCategories: async (query) => {
    const { page = 1, limit = 10, name, sort } = query;
    const filter = {
      isActive: true,
      deletedAt: null, // Đảm bảo chỉ lấy các category chưa xóa
    };

    if (name) {
      filter.name = { $regex: name, $options: "i" };
    }

    const options = {
      page,
      limit,
      sort: sort ? JSON.parse(sort) : { createdAt: -1 },
    };

    return await paginate(Category, filter, options);
  },

  /**
   * [PUBLIC] Lấy category theo ID (chỉ active và chưa xóa)
   */
  getPublicCategoryById: async (categoryId) => {
    const category = await Category.findOne({
      _id: categoryId,
      isActive: true,
      deletedAt: null, // Đảm bảo chỉ lấy category chưa xóa
    });

    if (!category) {
      throw new Error("Không tìm thấy danh mục");
    }

    return category;
  },

  /**
   * [PUBLIC] Lấy category theo slug (chỉ active và chưa xóa)
   */
  getCategoryBySlug: async (slug) => {
    const category = await Category.findOne({
      slug,
      isActive: true,
      deletedAt: null, // Đảm bảo chỉ lấy category chưa xóa
    });

    if (!category) {
      throw new Error("Không tìm thấy danh mục");
    }

    return category;
  },

  // === COMMON OPERATIONS ===

  /**
   * Tạo category mới
   */
  createCategory: async (categoryData) => {
    try {
      // Đảm bảo isActive mặc định là true nếu không được cung cấp
      if (categoryData.isActive === undefined) {
        categoryData.isActive = true;
      }

      const category = new Category(categoryData);
      await category.save();
      return category;
    } catch (error) {
      if (error.code === 11000) {
        throw new Error("Tên danh mục đã tồn tại");
      }
      throw error;
    }
  },

  /**
   * Cập nhật category
   */
  updateCategory: async (categoryId, categoryData) => {
    try {
      const category = await Category.findById(categoryId);
      if (!category) {
        throw new Error("Không tìm thấy danh mục");
      }

      // Cập nhật từng trường thay vì Object.assign để xử lý thêm logic nếu cần
      if (categoryData.name !== undefined) category.name = categoryData.name;
      if (categoryData.description !== undefined)
        category.description = categoryData.description;
      if (categoryData.isActive !== undefined)
        category.isActive = categoryData.isActive;

      // Các trường audit được thêm tự động bởi middleware

      await category.save();
      return category;
    } catch (error) {
      if (error.code === 11000) {
        throw new Error("Tên danh mục đã tồn tại");
      }
      throw error;
    }
  },

  /**
   * Xóa mềm category (chuyển method từ model vào service)
   */
  deleteCategory: async (categoryId, userId) => {
    const category = await Category.findById(categoryId);
    if (!category) {
      throw new Error("Không tìm thấy danh mục");
    }

    if (category.deletedAt) {
      throw new Error("Danh mục đã bị xóa trước đó");
    }

    // Sử dụng phương thức softDelete từ plugin
    await category.softDelete(userId);

    return { message: "Xóa danh mục thành công" };
  },

  /**
   * Khôi phục category đã xóa mềm (chuyển method từ model vào service)
   */
  restoreCategory: async (categoryId) => {
    try {
      // Sử dụng phương thức restoreById từ plugin
      const category = await Category.restoreById(categoryId);

      return {
        message: "Khôi phục danh mục thành công",
        category,
      };
    } catch (error) {
      console.error("Lỗi khôi phục category:", error);
      throw new Error("Không tìm thấy danh mục");
    }
  },

  /**
   * Cập nhật trạng thái active của category
   * Thêm logic cascade để ẩn/hiện các sản phẩm và biến thể liên quan
   */
  updateCategoryStatus: async (categoryId, isActive, cascade = true) => {
    const category = await Category.findById(categoryId);
    if (!category) {
      throw new Error("Không tìm thấy danh mục");
    }

    // Cập nhật trạng thái category
    category.isActive = isActive;
    await category.save();

    let affectedProducts = 0;

    // CASCADE: Chỉ cập nhật sản phẩm và biến thể khi cascade = true
    if (cascade) {
      // Cập nhật trạng thái tất cả sản phẩm thuộc category này
      const updateProductResult = await Product.updateMany(
        { category: categoryId },
        { isActive: isActive }
      );
      affectedProducts = updateProductResult.modifiedCount;

      // CASCADE: Cập nhật trạng thái tất cả biến thể của các sản phẩm thuộc category này
      const products = await Product.find({ category: categoryId });
      const productIds = products.map((product) => product._id);

      await Variant.updateMany(
        { product: { $in: productIds } },
        { isActive: isActive }
      );
    }

    const statusMsg = isActive ? "kích hoạt" : "vô hiệu hóa";
    return {
      message: cascade
        ? `Danh mục đã được ${statusMsg}. Đã ${statusMsg} ${affectedProducts} sản phẩm liên quan.`
        : `Danh mục đã được ${statusMsg} mà không ảnh hưởng đến sản phẩm.`,
      category,
    };
  },
};

module.exports = categoryService;
