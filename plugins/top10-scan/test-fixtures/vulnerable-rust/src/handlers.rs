use actix_web::{web, HttpRequest, HttpResponse};
use rusqlite::Connection;
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct ResetRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct UpdateUserRequest {
    pub name: String,
    pub bio: String,
}

pub async fn login(body: web::Json<LoginRequest>) -> HttpResponse {
    let conn = Connection::open("app.db").unwrap();

    // A05: SQL injection via format!() string interpolation
    let query = format!(
        "SELECT id, role FROM users WHERE email = '{}' AND password = '{}'",
        body.email, body.password
    );

    // A10: unwrap() on query that can fail - panics on SQL error
    let mut stmt = conn.prepare(&query).unwrap();
    let result = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).unwrap();

    match result.into_iter().next() {
        Some(Ok((id, role))) => {
            let token = auth::create_token(&id, &role);
            HttpResponse::Ok().json(serde_json::json!({"token": token}))
        }
        // A06: No rate limiting - allows brute force
        _ => HttpResponse::Unauthorized().json(serde_json::json!({"error": "Invalid credentials"})),
    }
}

pub async fn register(body: web::Json<RegisterRequest>) -> HttpResponse {
    let conn = Connection::open("app.db").unwrap();

    // A05: SQL injection via format!()
    let query = format!(
        "INSERT INTO users (email, password, name) VALUES ('{}', '{}', '{}')",
        body.email, body.password, body.name
    );

    conn.execute(&query, []).unwrap();
    HttpResponse::Created().json(serde_json::json!({"message": "User created"}))
}

pub async fn reset_password(body: web::Json<ResetRequest>) -> HttpResponse {
    // A06: Predictable reset token based on timestamp
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let reset_token = format!("reset-{}-{}", body.email, timestamp);

    HttpResponse::Ok().json(serde_json::json!({
        "message": "Reset email sent",
        // A10: Leaking reset token in response
        "debug_token": reset_token
    }))
}

pub async fn get_user(path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let conn = Connection::open("app.db").unwrap();

    // A05: SQL injection via format!()
    // A01: No ownership check - any user can view any profile
    let query = format!("SELECT * FROM users WHERE id = '{}'", id);

    match conn.prepare(&query) {
        Ok(mut stmt) => {
            let result = stmt.query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0).unwrap_or_default(),
                    "email": row.get::<_, String>(1).unwrap_or_default(),
                    "name": row.get::<_, String>(3).unwrap_or_default(),
                }))
            });
            match result {
                Ok(rows) => {
                    let users: Vec<_> = rows.filter_map(|r| r.ok()).collect();
                    HttpResponse::Ok().json(users)
                }
                // A10: Database error details leaked to client
                Err(e) => HttpResponse::InternalServerError()
                    .json(serde_json::json!({"error": format!("Database error: {}", e)})),
            }
        }
        // A10: Database error details leaked to client
        Err(e) => HttpResponse::InternalServerError()
            .json(serde_json::json!({"error": format!("Query failed: {}", e)})),
    }
}

pub async fn update_user(
    path: web::Path<String>,
    body: web::Json<UpdateUserRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    let conn = Connection::open("app.db").unwrap();

    // A05: SQL injection via format!()
    // A01: No ownership check
    let query = format!(
        "UPDATE users SET name = '{}', bio = '{}' WHERE id = '{}'",
        body.name, body.bio, id
    );

    match conn.execute(&query, []) {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({"message": "Updated"})),
        // A10: Leaking internal error
        Err(e) => HttpResponse::InternalServerError()
            .json(serde_json::json!({"error": format!("{}", e)})),
    }
}

// A01: No auth check on admin endpoint
pub async fn list_all_users() -> HttpResponse {
    let conn = Connection::open("app.db").unwrap();
    let mut stmt = conn.prepare("SELECT id, email, name, role FROM users").unwrap();
    let users: Vec<_> = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "email": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "role": row.get::<_, String>(3)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    HttpResponse::Ok().json(users)
}

// A01: No auth check on destructive admin action
pub async fn delete_user(path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let conn = Connection::open("app.db").unwrap();

    // A05: SQL injection
    let query = format!("DELETE FROM users WHERE id = '{}'", id);
    conn.execute(&query, []).unwrap();

    HttpResponse::Ok().json(serde_json::json!({"message": "Deleted"}))
}
