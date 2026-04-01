use actix_web::{web, App, HttpServer};

mod auth;
mod handlers;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            // Public routes
            .route("/login", web::post().to(handlers::login))
            .route("/register", web::post().to(handlers::register))
            .route("/reset-password", web::post().to(handlers::reset_password))
            // A01: No auth middleware on user routes
            .route("/users/{id}", web::get().to(handlers::get_user))
            .route("/users/{id}", web::put().to(handlers::update_user))
            // A01: No auth middleware on admin routes
            .route("/admin/users", web::get().to(handlers::list_all_users))
            .route("/admin/users/{id}", web::delete().to(handlers::delete_user))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}
