using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// A02: CORS allows all origins with credentials
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection")));

var app = builder.Build();

// A02: Developer exception page enabled unconditionally (not just Development)
app.UseDeveloperExceptionPage();

// A02: Swagger exposed in all environments
app.UseSwagger();
app.UseSwaggerUI();

// A02: Missing app.UseHttpsRedirection()
// A02: Missing app.UseHsts()

app.UseCors();
app.UseAuthorization();
app.MapControllers();

app.Run();

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }
    public DbSet<User> Users { get; set; }
}

public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string Password { get; set; } = "";
    public string Role { get; set; } = "user";
}
