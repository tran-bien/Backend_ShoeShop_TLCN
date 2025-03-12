const express = require("express");
const { protect, admin } = require("../middlewares/auth.middleware");
const {
  getColors,
  createColor,
  updateColor,
  deleteColor,
  deactivateColor,
  activateColor,
} = require("../controllers/color.controller");

const router = express.Router();

// Route công khai
router.get("/", getColors);

// Route cho Admin - yêu cầu đăng nhập và quyền Admin
router.use(protect);
router.use(admin);

router.post("/", createColor);
router.put("/:colorId", updateColor);
router.put("/:colorId/deactivate", deactivateColor);
router.put("/:colorId/activate", activateColor);
router.delete("/:colorId", deleteColor);

module.exports = router;
