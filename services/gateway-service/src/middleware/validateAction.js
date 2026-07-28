const { body, validationResult } = require("express-validator");

const validateAction = [
  body("agentId")
    .isUUID()
    .withMessage("agentId must be a valid UUID"),
  body("action")
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 100 })
    .escape()
    .withMessage("action must be a non-empty string under 100 chars"),
  body("amount")
    .isFloat({ min: 0, max: 1000000 })
    .withMessage("amount must be a positive number under 1,000,000"),
  body("context")
    .optional()
    .isObject()
    .withMessage("context must be an object if provided"),
];

function checkValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "validation_failed", details: errors.array() });
  }
  next();
}

module.exports = { validateAction, checkValidation };
