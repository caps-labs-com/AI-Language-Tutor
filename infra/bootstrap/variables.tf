variable "google_project_id" {
  description = "Existing Google Cloud project ID with billing enabled."
  type        = string
}

variable "google_region" {
  description = "Primary Google Cloud region."
  type        = string
  default     = "us-east1"
}

variable "github_repository" {
  description = "GitHub repository allowed to exchange OIDC tokens."
  type        = string
  default     = "caps-labs-com/AI-Language-Tutor"
}

variable "github_branch" {
  description = "Git branch allowed to assume deployment identities."
  type        = string
  default     = "main"
}

variable "terraform_state_bucket_name" {
  description = "Globally unique GCS bucket name for the main Terraform state."
  type        = string
}
