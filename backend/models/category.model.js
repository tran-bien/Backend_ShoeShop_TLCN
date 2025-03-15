const mongoose = require("mongoose");
const slugify = require("slugify");

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Tên danh mục là bắt buộc"],
      trim: true,
      maxlength: [50, "Tên danh mục không được vượt quá 50 ký tự"],
    },
    description: {
      type: String,
      maxlength: [500, "Mô tả danh mục không được vượt quá 500 ký tự"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

CategorySchema.pre("save", function (next) {
  if (this.isModified("name") || !this.slug) {
    this.slug = slugify(this.name, { lower: true, remove: /[*+~.()'"!:@]/g });
  }
  next();
});

const Category = mongoose.model("Category", CategorySchema);

module.exports = Category;
