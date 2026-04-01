using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace VulnerableApp.Controllers;

[ApiController]
[Route("api/[controller]")]
// A01: No [Authorize] attribute - anyone can access admin endpoints
public class AdminController : ControllerBase
{
    private readonly AppDbContext _db;

    public AdminController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet("users")]
    public async Task<IActionResult> ListAllUsers()
    {
        // Returns all user data including password hashes
        var users = await _db.Users.ToListAsync();
        return Ok(users);
    }

    [HttpDelete("users/{id}")]
    public async Task<IActionResult> DeleteUser(int id)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null)
            return NotFound();

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();

        // A09-adjacent: No audit logging of admin deletion
        return Ok(new { message = "Deleted" });
    }
}
