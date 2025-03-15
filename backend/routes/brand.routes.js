const express = require("express");
const router = express.Router();
const {
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
  checkDeletableBrand,
  getBrandsForUser,
  getBrandsForAdmin,
  toggleActive,
  getBrandBySlugForUser,
  getBrandBySlugForAdmin,
} = require("../controllers/brand.controller");
const { protect, admin } = require("../middlewares/auth.middleware");

// Route cho người dùng
router.get("/", getBrandsForUser);
router.get("/slug/:slug", getBrandBySlugForUser);
// Route cho admin
router.get("/admin", protect, admin, getBrandsForAdmin);

// Route công khai - lấy chi tiết thương hiệu
router.get("/:id", getBrandById);

// Routes cho Admin khác
router.use(protect);
router.use(admin);

router.post("/", createBrand);
router.put("/:id", updateBrand);
router.delete("/:id", deleteBrand);
router.get("/check-delete/:id", checkDeletableBrand);
router.patch("/:id/toggle", toggleActive);
router.get("/admin/slug/:slug", getBrandBySlugForAdmin);

module.exports = router;
