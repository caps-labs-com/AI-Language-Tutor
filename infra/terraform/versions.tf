terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }

    google = {
      source  = "hashicorp/google"
      version = "~> 8.1"
    }

    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }
}
