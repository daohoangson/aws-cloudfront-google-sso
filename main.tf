resource "random_pet" "this" {
  length = 2
}

module "s3_bucket" {
  source = "terraform-aws-modules/s3-bucket/aws"
  bucket = "${random_pet.this.id}-s3-bucket"

  # for testing only, this should be false in production
  force_destroy = true
}

resource "aws_s3_object" "s3_upload" {
  bucket       = module.s3_bucket.s3_bucket_id
  key          = "index.html"
  content      = "Hello, World!"
  content_type = "text/html"
}

module "lambda_function" {
  source = "terraform-aws-modules/lambda/aws"

  function_name  = "${random_pet.this.id}-lambda-function"
  lambda_at_edge = true
  publish        = true

  handler = "index.handler"
  runtime = "nodejs22.x"
  source_path = [
    {
      path = "./lambda_function",
      commands : [
        "npm install",
        "GOOGLE_CLIENT_ID=${var.google_client_id} npm run build",
        ":zip dist/index.js",
      ]
    }
  ]
}

module "cloudfront" {
  source = "terraform-aws-modules/cloudfront/aws"

  default_root_object = "index.html"
  enabled             = true

  create_origin_access_control = true
  origin_access_control = {
    s3_bucket = {
      description      = "CloudFront access to S3"
      origin_type      = "s3"
      signing_behavior = "always"
      signing_protocol = "sigv4"
    }
  }

  origin = {
    s3_bucket = {
      domain_name           = module.s3_bucket.s3_bucket_bucket_regional_domain_name
      origin_access_control = "s3_bucket"
    }
  }

  default_cache_behavior = {
    target_origin_id       = "s3_bucket"
    viewer_protocol_policy = "allow-all"
    allowed_methods        = ["HEAD", "DELETE", "POST", "GET", "OPTIONS", "PUT", "PATCH"]
    cached_methods         = ["GET", "HEAD"]

    lambda_function_association = {
      viewer-request = {
        lambda_arn   = module.lambda_function.lambda_function_qualified_arn
        include_body = true
      }
    }
  }
}

data "aws_iam_policy_document" "s3_oac_doc" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${module.s3_bucket.s3_bucket_arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [module.cloudfront.cloudfront_distribution_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "s3_oac_policy" {
  bucket = module.s3_bucket.s3_bucket_id
  policy = data.aws_iam_policy_document.s3_oac_doc.json
}
