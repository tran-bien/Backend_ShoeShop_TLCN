const asyncHandler = require("express-async-handler");
const sizeService = require("@services/size.service");

const sizeController = {
  /**
   * @desc    Lấy danh sách tất cả kích thước (admin)
   * @route   GET /api/admin/sizes
   * @access  Admin
   */
  getAllSizes: asyncHandler(async (req, res) => {
    const result = await sizeService.getSizes(req.query);
    res.json(result);
  }),

  /**
   * @desc    Lấy danh sách kích thước đã xóa
   * @route   GET /api/admin/sizes/deleted
   * @access  Admin
   */
  getDeletedSizes: asyncHandler(async (req, res) => {
    const result = await sizeService.getDeletedSizes(req.query);
    res.json(result);
  }),

  /**
   * @desc    Lấy thông tin chi tiết kích thước theo ID
   * @route   GET /api/admin/sizes/:id
   * @access  Admin
   */
  getSizeById: asyncHandler(async (req, res) => {
    const result = await sizeService.getSizeById(req.params.id);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  }),

  /**
   * @desc    Tạo kích thước mới
   * @route   POST /api/admin/sizes
   * @access  Admin
   */
  createSize: asyncHandler(async (req, res) => {
    const result = await sizeService.createSize(req.body);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  }),

  /**
   * @desc    Cập nhật kích thước
   * @route   PUT /api/admin/sizes/:id
   * @access  Admin
   */
  updateSize: asyncHandler(async (req, res) => {
    const result = await sizeService.updateSize(req.params.id, req.body);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  }),

  /**
   * @desc    Xóa kích thước (soft delete)
   * @route   DELETE /api/admin/sizes/:id
   * @access  Admin
   */
  deleteSize: asyncHandler(async (req, res) => {
    const result = await sizeService.deleteSize(req.params.id, req.user._id);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  }),

  /**
   * @desc    Khôi phục kích thước đã xóa
   * @route   PUT /api/admin/sizes/:id/restore
   * @access  Admin
   */
  restoreSize: asyncHandler(async (req, res) => {
    const result = await sizeService.restoreSize(req.params.id);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  }),
};

module.exports = sizeController;
