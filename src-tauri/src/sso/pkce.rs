//! PKCE (RFC 7636): generación de code_verifier, code_challenge y state.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// Par PKCE: el verifier se guarda en memoria durante el flujo; el challenge se envía al SSO.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    /// Genera un nuevo par. El verifier son 32 bytes aleatorios en base64url (sin padding);
    /// el challenge es base64url(SHA256(verifier)) sin padding.
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let verifier = URL_SAFE_NO_PAD.encode(bytes);
        let challenge = challenge_from_verifier(&verifier);
        Pkce {
            verifier,
            challenge,
        }
    }
}

/// Deriva el code_challenge de un code_verifier dado.
pub fn challenge_from_verifier(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// Genera un valor `state` aleatorio (anti-CSRF).
pub fn random_state() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vector canónico del RFC 7636, Apéndice B.
    #[test]
    fn rfc7636_test_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = challenge_from_verifier(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn generated_pair_is_consistent() {
        let p = Pkce::generate();
        assert_eq!(p.challenge, challenge_from_verifier(&p.verifier));
        // base64url sin padding => sin '=' '+' '/'
        for s in [&p.verifier, &p.challenge] {
            assert!(!s.contains('='));
            assert!(!s.contains('+'));
            assert!(!s.contains('/'));
        }
    }
}
