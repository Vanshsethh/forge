const { body, param, validationResult } = require("express-validator");

const validateCreateAgent = [
  body("name").isString().trim().notEmpty().isLength({ max: 100 }),
  body("agentType")
    .optional()
    .isIn(["payments", "servicing", "travel"]),
  body("agent_type")
    .optional()
    .isIn(["payments", "servicing", "travel"]),
];

const validateAgentId = [
  param("id")
    .optional()
    .isUUID()
    .withMessage("agentId must be a valid UUID"),
  param("agentId")
    .optional()
    .isUUID()
    .withMessage("agentId must be a valid UUID"),
];

function checkValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: "validation_failed", details: errors.array() });
  }
  next();
}

module.exports = { validateCreateAgent, validateAgentId, checkValidation };
