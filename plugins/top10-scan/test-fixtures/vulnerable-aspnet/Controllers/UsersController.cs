using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace VulnerableApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly HttpClient _httpClient = new();

    public UsersController(AppDbContext db)
    {
        _db = db;
    }

    // A01: No authorization, no ownership check
    [HttpGet("{id}")]
    public async Task<IActionResult> GetUser(string id)
    {
        try
        {
            // A05: SQL injection via string interpolation
            var users = await _db.Users
                .FromSqlRaw($"SELECT * FROM Users WHERE Id = '{id}'")
                .ToListAsync();

            if (!users.Any())
                return NotFound();

            return Ok(users.First());
        }
        catch (Exception ex)
        {
            // A10: Raw exception message returned to client
            return StatusCode(500, new { error = ex.Message, stackTrace = ex.StackTrace });
        }
    }

    // A01: No authorization on update
    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateUser(string id, [FromBody] UpdateRequest request)
    {
        try
        {
            // A05: SQL injection via string interpolation
            await _db.Database.ExecuteSqlRawAsync(
                $"UPDATE Users SET Name = '{request.Name}', Bio = '{request.Bio}' WHERE Id = '{id}'");

            return Ok(new { message = "Updated" });
        }
        catch (Exception ex)
        {
            // A10: Leaked internal error details
            return StatusCode(500, new { error = $"Database error: {ex.Message}" });
        }
    }

    [HttpPost("fetch-avatar")]
    public async Task<IActionResult> FetchAvatar([FromQuery] string url)
    {
        // A10: No timeout on external HTTP call, no URL validation
        try
        {
            var response = await _httpClient.GetAsync(url);
            var content = await response.Content.ReadAsByteArrayAsync();
            return Ok(new { status = (int)response.StatusCode, length = content.Length });
        }
        catch (Exception ex)
        {
            // A10: Raw exception leaked
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

public class UpdateRequest
{
    public string Name { get; set; } = "";
    public string Bio { get; set; } = "";
}
