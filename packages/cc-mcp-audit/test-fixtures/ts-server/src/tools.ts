// Object-style registration
const tools = [
  {
    name: "deploy_app",
    description: "Deploy application to production environment",
    handler: deployHandler,
  },
  {
    name: "check_health",
    description: "Check application health status",
    handler: healthHandler,
  },
];

export default tools;
