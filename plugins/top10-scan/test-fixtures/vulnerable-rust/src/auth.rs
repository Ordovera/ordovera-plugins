use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use serde::{Deserialize, Serialize};

// A04: Hardcoded JWT secret - weak key
const JWT_SECRET: &str = "secret123";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    // A04: No exp field - tokens never expire
}

pub fn create_token(user_id: &str, role: &str) -> String {
    let claims = Claims {
        sub: user_id.to_string(),
        role: role.to_string(),
    };

    // A04: HMAC-SHA256 with weak secret, no expiration
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET.as_ref()),
    )
    .unwrap()
}

pub fn verify_token(token: &str) -> Option<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(JWT_SECRET.as_ref()),
        &Validation::default(),
    )
    .ok()
    .map(|data| data.claims)
}
