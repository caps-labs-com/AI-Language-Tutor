locals {
  google_cloud_apis = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "texttospeech.googleapis.com",
  ])

  backend_secret_ids = {
    GEMINI_API_KEY             = "gemini-api-key"
    DEEPSEEK_API_KEY           = "deepseek-api-key"
    SUPABASE_SERVICE_ROLE_KEY  = "supabase-service-role-key"
    ASAAS_API_KEY              = "asaas-api-key"
    ASAAS_WEBHOOK_ACCESS_TOKEN = "asaas-webhook-access-token"
    RESEND_API_KEY             = "resend-api-key"
  }

  backend_environment = {
    APP_ENV                           = "production"
    APP_ALLOWED_ORIGINS               = join(",", var.backend_allowed_origins)
    GOOGLE_CLOUD_PROJECT              = var.google_project_id
    SUPABASE_URL                      = coalesce(var.backend_supabase_url, "https://not-configured.invalid")
    LLM_PRIMARY_PROVIDER              = "gemini"
    LLM_FALLBACK_PROVIDERS            = "deepseek"
    LLM_PREMIUM_TUTOR_REPLY_PROVIDERS = "deepseek,gemini"
    LLM_REQUEST_TIMEOUT_SECONDS       = "20"
    LLM_MAX_OUTPUT_TOKENS             = "1024"
    LLM_MAX_RETRIES                   = "2"
    LLM_CIRCUIT_FAILURE_THRESHOLD     = "3"
    LLM_CIRCUIT_RECOVERY_SECONDS      = "30"
    LLM_MAX_COST_PER_REQUEST_USD      = "0.02"
    GEMINI_MODEL                      = "gemini-3.1-flash-lite"
    GEMINI_INPUT_USD_PER_MILLION      = "0.25"
    GEMINI_OUTPUT_USD_PER_MILLION     = "1.50"
    DEEPSEEK_MODEL                    = "deepseek-v4-flash"
    DEEPSEEK_INPUT_USD_PER_MILLION    = "0.14"
    DEEPSEEK_OUTPUT_USD_PER_MILLION   = "0.28"
    ASAAS_BILLING_ENABLED             = "true"
    ASAAS_ENVIRONMENT                 = "production"
    ASAAS_MOCK_CHECKOUT               = "false"
    BILLING_SITE_URL                  = "${var.site_url}/"
    BILLING_EMAIL_FROM                = "Lume Tutor <noreply@caps-labs.com>"
    SPEECH_SYNTHESIS_ENABLED          = "true"
    SPEECH_SYNTHESIS_PROVIDER         = "google_standard"
    SPEECH_SYNTHESIS_CACHE_VERSION    = "2026-08-02-v1"
  }
}

data "google_project" "current" {
  count = var.enable_google_cloud ? 1 : 0

  project_id = var.google_project_id
}

resource "google_project_service" "backend" {
  for_each = var.enable_google_cloud ? local.google_cloud_apis : toset([])

  project            = var.google_project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "backend" {
  count = var.enable_google_cloud ? 1 : 0

  project      = var.google_project_id
  account_id   = "lume-tutor-${substr(var.environment, 0, 4)}"
  display_name = "Lume Tutor API (${var.environment})"

  depends_on = [google_project_service.backend]
}

resource "google_secret_manager_secret" "backend" {
  for_each = var.enable_google_cloud ? local.backend_secret_ids : {}

  project   = var.google_project_id
  secret_id = "${each.value}-${var.environment}"

  replication {
    auto {}
  }

  deletion_protection = var.environment == "production"

  depends_on = [google_project_service.backend]
}

resource "google_secret_manager_secret_iam_member" "backend_accessor" {
  for_each = var.enable_google_cloud ? local.backend_secret_ids : {}

  project   = var.google_project_id
  secret_id = google_secret_manager_secret.backend[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend[0].email}"
}

resource "google_cloud_run_v2_service" "backend" {
  count = var.enable_google_cloud && var.enable_cloud_run_backend ? 1 : 0

  project             = var.google_project_id
  name                = "lume-tutor-api-${var.environment}"
  location            = var.google_region
  deletion_protection = var.environment == "production"
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.backend[0].email
    timeout                          = "60s"
    max_instance_request_concurrency = 20

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = var.cloud_run_max_instances
    }

    containers {
      image = var.backend_container_image

      ports {
        container_port = 8000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      dynamic "env" {
        for_each = local.backend_environment
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.backend_secret_ids
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.backend[env.key].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 12

        tcp_socket {
          port = 8000
        }
      }
    }
  }

  lifecycle {
    # Application releases update only the image. Terraform owns all other
    # service settings and intentionally ignores this deployment-only field.
    ignore_changes = [template[0].containers[0].image]

    precondition {
      condition     = var.backend_container_image != null && var.backend_container_image != ""
      error_message = "backend_container_image is required when enable_cloud_run_backend is true."
    }

    precondition {
      condition     = var.backend_supabase_url != null && startswith(var.backend_supabase_url, "https://")
      error_message = "backend_supabase_url must be an HTTPS URL when Cloud Run is enabled."
    }

    precondition {
      condition     = var.backend_public_url != null && startswith(var.backend_public_url, "https://")
      error_message = "backend_public_url must be an HTTPS URL when Cloud Run is enabled."
    }
  }

  depends_on = [
    google_project_service.backend,
    google_secret_manager_secret_iam_member.backend_accessor,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count = var.enable_google_cloud && var.enable_cloud_run_backend ? 1 : 0

  project  = var.google_project_id
  location = var.google_region
  name     = google_cloud_run_v2_service.backend[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_billing_budget" "project" {
  count = var.enable_google_cloud && var.enable_google_billing_budget ? 1 : 0

  billing_account = var.google_billing_account_id
  display_name    = "Lume Tutor ${var.environment}"

  budget_filter {
    projects = ["projects/${data.google_project.current[0].number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.google_monthly_budget_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = toset([0.5, 0.8, 1.0])
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  lifecycle {
    precondition {
      condition     = var.google_billing_account_id != null && var.google_billing_account_id != ""
      error_message = "google_billing_account_id is required when enable_google_billing_budget is true."
    }
  }

  depends_on = [google_project_service.backend]
}
