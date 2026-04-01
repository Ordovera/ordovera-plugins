using Microsoft.AspNetCore.Mvc;

namespace VulnerableApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class WebhookController : ControllerBase
{
    // A08: Webhook accepts payload without signature verification
    [HttpPost("payment")]
    public IActionResult HandlePaymentWebhook([FromBody] dynamic payload)
    {
        // A08: No HMAC signature validation
        // A08: No schema validation on incoming payload
        // A10: No error handling
        string eventType = payload.type;
        string amount = payload.data.amount;

        // Process payment event without verifying it came from the payment provider
        return Ok(new { received = true });
    }

    // A08: No signature verification on deployment hook
    [HttpPost("deploy")]
    public IActionResult HandleDeployWebhook([FromBody] dynamic payload)
    {
        string branch = payload.ref;
        // Blindly trusts the webhook payload
        return Ok(new { deploying = branch });
    }
}
