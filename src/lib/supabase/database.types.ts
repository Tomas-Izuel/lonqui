
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "app_users": {
                  Row: {
                    "created_at": string,"created_by": string | null,"display_name": string,"email": string,"is_active": boolean,"must_change_password": boolean,"password_changed_at": string | null,"password_reset_at": string | null,"role": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"display_name": string,"email": string,"is_active"?: boolean,"must_change_password"?: boolean,"password_changed_at"?: string | null,"password_reset_at"?: string | null,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"display_name"?: string,"email"?: string,"is_active"?: boolean,"must_change_password"?: boolean,"password_changed_at"?: string | null,"password_reset_at"?: string | null,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_log": {
                  Row: {
                    "actor_id": string | null,"actor_source": string,"changed_fields": (string)[] | null,"context": Json | null,"id": number,"new_data": Json | null,"occurred_at": string,"old_data": Json | null,"op": string,"record_id": string | null,"table_name": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"actor_source": string,"changed_fields"?: (string)[] | null,"context"?: Json | null,"id"?: never,"new_data"?: Json | null,"occurred_at"?: string,"old_data"?: Json | null,"op": string,"record_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_source"?: string,"changed_fields"?: (string)[] | null,"context"?: Json | null,"id"?: never,"new_data"?: Json | null,"occurred_at"?: string,"old_data"?: Json | null,"op"?: string,"record_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"billing_runs": {
                  Row: {
                    "actor_id": string | null,"error_message": string | null,"fees_created": number,"finished_at": string | null,"id": number,"notified_at": string | null,"period": string,"started_at": string,"status": string,"trigger": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"error_message"?: string | null,"fees_created"?: number,"finished_at"?: string | null,"id"?: never,"notified_at"?: string | null,"period": string,"started_at"?: string,"status": string,"trigger": string
                  }
                  Update: {
                    "actor_id"?: string | null,"error_message"?: string | null,"fees_created"?: number,"finished_at"?: string | null,"id"?: never,"notified_at"?: string | null,"period"?: string,"started_at"?: string,"status"?: string,"trigger"?: string
                  }
                  Relationships: [
                    
                  ]
                },"cash_concepts": {
                  Row: {
                    "created_at": string,"direction": string,"id": number,"is_active": boolean,"name": string,"requires_sponsor": boolean,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"direction"?: string,"id"?: never,"is_active"?: boolean,"name": string,"requires_sponsor"?: boolean,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"direction"?: string,"id"?: never,"is_active"?: boolean,"name"?: string,"requires_sponsor"?: boolean,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"cash_movements": {
                  Row: {
                    "amount_cents": number,"batch_id": string,"concept_id": number,"created_at": string,"created_by": string | null,"description": string | null,"direction": string,"id": number,"method": string,"occurred_on": string,"receipt_filename": string | null,"receipt_storage_path": string | null,"sponsor_id": number | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"batch_id": string,"concept_id": number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"direction"?: string,"id"?: never,"method": string,"occurred_on"?: string,"receipt_filename"?: string | null,"receipt_storage_path"?: string | null,"sponsor_id"?: number | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"batch_id"?: string,"concept_id"?: number,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"direction"?: string,"id"?: never,"method"?: string,"occurred_on"?: string,"receipt_filename"?: string | null,"receipt_storage_path"?: string | null,"sponsor_id"?: number | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_movements_concept_id_fkey"
      columns: ["concept_id"]
isOneToOne: false
      referencedRelation: "cash_concepts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_movements_sponsor_id_fkey"
      columns: ["sponsor_id"]
isOneToOne: false
      referencedRelation: "sponsors"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"discipline_id": number,"id": number,"is_active": boolean,"name": string,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"discipline_id": number,"id"?: never,"is_active"?: boolean,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"discipline_id"?: number,"id"?: never,"is_active"?: boolean,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    }
                  ]
                },"disciplines": {
                  Row: {
                    "created_at": string,"id": number,"is_active": boolean,"name": string,"sort_order": number,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: never,"is_active"?: boolean,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"is_active"?: boolean,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"family_groups": {
                  Row: {
                    "created_at": string,"id": number,"name": string | null,"notes": string | null,"payer_contact_name": string | null,"payer_contact_phone": string | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: never,"name"?: string | null,"notes"?: string | null,"payer_contact_name"?: string | null,"payer_contact_phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"name"?: string | null,"notes"?: string | null,"payer_contact_name"?: string | null,"payer_contact_phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"fee_prices": {
                  Row: {
                    "amount_cents": number,"category_id": number | null,"created_at": string,"created_by": string | null,"id": number,"member_type": string | null,"notes": string | null,"scope": string,"valid_from": string
                  }
                  Insert: {
                    "amount_cents": number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_type"?: string | null,"notes"?: string | null,"scope": string,"valid_from": string
                  }
                  Update: {
                    "amount_cents"?: number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_type"?: string | null,"notes"?: string | null,"scope"?: string,"valid_from"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fee_prices_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"fees": {
                  Row: {
                    "amount_cents": number,"category_id": number | null,"created_at": string,"created_by": string | null,"description": string | null,"discipline_id": number | null,"fee_price_id": number | null,"from_period": string | null,"id": number,"kind": string,"member_id": number,"period": string,"to_period": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"discipline_id"?: number | null,"fee_price_id"?: number | null,"from_period"?: string | null,"id"?: never,"kind": string,"member_id": number,"period": string,"to_period"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"category_id"?: number | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"discipline_id"?: number | null,"fee_price_id"?: number | null,"from_period"?: string | null,"id"?: never,"kind"?: string,"member_id"?: number,"period"?: string,"to_period"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fees_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_fee_price_id_fkey"
      columns: ["fee_price_id"]
isOneToOne: false
      referencedRelation: "fee_prices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"medical_clearances": {
                  Row: {
                    "created_at": string,"expires_on": string,"id": number,"member_id": number,"notes": string | null,"original_filename": string | null,"storage_path": string | null,"updated_at": string,"uploaded_by": string | null
                  }
                  Insert: {
                    "created_at"?: string,"expires_on": string,"id"?: never,"member_id": number,"notes"?: string | null,"original_filename"?: string | null,"storage_path"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_on"?: string,"id"?: never,"member_id"?: number,"notes"?: string | null,"original_filename"?: string | null,"storage_path"?: string | null,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "medical_clearances_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"member_categories": {
                  Row: {
                    "category_id": number,"created_at": string,"created_by": string | null,"id": number,"joined_on": string,"left_at": string | null,"left_by": string | null,"left_on": string | null,"left_reason": string | null,"member_id": number
                  }
                  Insert: {
                    "category_id": number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"joined_on": string,"left_at"?: string | null,"left_by"?: string | null,"left_on"?: string | null,"left_reason"?: string | null,"member_id": number
                  }
                  Update: {
                    "category_id"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"joined_on"?: string,"left_at"?: string | null,"left_by"?: string | null,"left_on"?: string | null,"left_reason"?: string | null,"member_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_categories_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "member_categories_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"member_status_events": {
                  Row: {
                    "created_at": string,"created_by": string | null,"effective_on": string,"event_type": string,"id": number,"member_id": number,"notes": string | null,"reason": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"effective_on": string,"event_type": string,"id"?: never,"member_id": number,"notes"?: string | null,"reason": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"effective_on"?: string,"event_type"?: string,"id"?: never,"member_id"?: number,"notes"?: string | null,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_status_events_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"members": {
                  Row: {
                    "address": string | null,"birth_date": string | null,"created_at": string,"created_by": string | null,"dni": string | null,"email": string | null,"family_group_id": number | null,"first_name": string,"id": number,"is_payment_responsible": boolean,"joined_on": string,"last_name": string,"member_type": string,"notes": string | null,"phone": string | null,"search_text": string | null,"status": string,"status_changed_on": string | null,"updated_at": string,"member_balance_cents": number | null,"member_debt_status": string | null,"member_months_due": number | null
                  }
                  Insert: {
                    "address"?: string | null,"birth_date"?: string | null,"created_at"?: string,"created_by"?: string | null,"dni"?: string | null,"email"?: string | null,"family_group_id"?: number | null,"first_name": string,"id"?: never,"is_payment_responsible"?: boolean,"joined_on": string,"last_name": string,"member_type"?: string,"notes"?: string | null,"phone"?: string | null,"search_text"?: never,"status"?: string,"status_changed_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"birth_date"?: string | null,"created_at"?: string,"created_by"?: string | null,"dni"?: string | null,"email"?: string | null,"family_group_id"?: number | null,"first_name"?: string,"id"?: never,"is_payment_responsible"?: boolean,"joined_on"?: string,"last_name"?: string,"member_type"?: string,"notes"?: string | null,"phone"?: string | null,"search_text"?: never,"status"?: string,"status_changed_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "members_family_group_id_fkey"
      columns: ["family_group_id"]
isOneToOne: false
      referencedRelation: "family_groups"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_allocations": {
                  Row: {
                    "amount_cents": number,"created_at": string,"created_by": string | null,"fee_id": number,"id": number,"payment_id": number,"source": string
                  }
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"created_by"?: string | null,"fee_id": number,"id"?: never,"payment_id": number,"source": string
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"created_by"?: string | null,"fee_id"?: number,"id"?: never,"payment_id"?: number,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_allocations_fee_id_fkey"
      columns: ["fee_id"]
isOneToOne: false
      referencedRelation: "fee_status"
      referencedColumns: ["fee_id"]
    },{
      foreignKeyName: "payment_allocations_fee_id_fkey"
      columns: ["fee_id"]
isOneToOne: false
      referencedRelation: "fees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_allocations_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payment_credit"
      referencedColumns: ["payment_id"]
    },{
      foreignKeyName: "payment_allocations_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"batch_id": string,"created_at": string,"created_by": string | null,"id": number,"member_id": number,"method": string,"notes": string | null,"paid_on": string,"receipt_filename": string | null,"receipt_storage_path": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  Insert: {
                    "amount_cents": number,"batch_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_id": number,"method": string,"notes"?: string | null,"paid_on"?: string,"receipt_filename"?: string | null,"receipt_storage_path"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"batch_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: never,"member_id"?: number,"method"?: string,"notes"?: string | null,"paid_on"?: string,"receipt_filename"?: string | null,"receipt_storage_path"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"portal_access_request_people": {
                  Row: {
                    "created_at": string,"dni": string | null,"first_name": string,"id": number,"last_name": string,"relationship": string,"request_id": number
                  }
                  Insert: {
                    "created_at"?: string,"dni"?: string | null,"first_name": string,"id"?: never,"last_name": string,"relationship": string,"request_id": number
                  }
                  Update: {
                    "created_at"?: string,"dni"?: string | null,"first_name"?: string,"id"?: never,"last_name"?: string,"relationship"?: string,"request_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "portal_access_request_people_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "portal_access_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"portal_access_requests": {
                  Row: {
                    "created_at": string,"dni": string,"email": string | null,"first_name": string,"id": number,"last_name": string,"message": string | null,"phone_e164": string | null,"phone_raw": string,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"dni": string,"email"?: string | null,"first_name": string,"id"?: never,"last_name": string,"message"?: string | null,"phone_e164"?: string | null,"phone_raw": string,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"dni"?: string,"email"?: string | null,"first_name"?: string,"id"?: never,"last_name"?: string,"message"?: string | null,"phone_e164"?: string | null,"phone_raw"?: string,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"portal_access_tokens": {
                  Row: {
                    "account_id": string | null,"consumed_at": string | null,"consumed_by": string | null,"created_at": string,"created_by": string,"delivery": string,"expires_at": string,"failed_checks": number,"family_scope": boolean,"id": number,"member_id": number | null,"purpose": string,"relationship": string | null,"request_id": number | null,"requires_dni_check": boolean,"revoke_reason": string | null,"revoked_at": string | null,"revoked_by": string | null,"token_hash": string
                  }
                  Insert: {
                    "account_id"?: string | null,"consumed_at"?: string | null,"consumed_by"?: string | null,"created_at"?: string,"created_by"?: string,"delivery": string,"expires_at": string,"failed_checks"?: number,"family_scope"?: boolean,"id"?: never,"member_id"?: number | null,"purpose": string,"relationship"?: string | null,"request_id"?: number | null,"requires_dni_check": boolean,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"token_hash": string
                  }
                  Update: {
                    "account_id"?: string | null,"consumed_at"?: string | null,"consumed_by"?: string | null,"created_at"?: string,"created_by"?: string,"delivery"?: string,"expires_at"?: string,"failed_checks"?: number,"family_scope"?: boolean,"id"?: never,"member_id"?: number | null,"purpose"?: string,"relationship"?: string | null,"request_id"?: number | null,"requires_dni_check"?: boolean,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "portal_access_tokens_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "portal_accounts"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "portal_access_tokens_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "portal_access_tokens_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "portal_access_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"portal_account_members": {
                  Row: {
                    "account_id": string,"created_at": string,"family_scope": boolean,"id": number,"linked_by": string | null,"member_id": number,"relationship": string,"revoke_reason": string | null,"revoked_at": string | null,"revoked_by": string | null,"token_id": number | null
                  }
                  Insert: {
                    "account_id": string,"created_at"?: string,"family_scope"?: boolean,"id"?: never,"linked_by"?: string | null,"member_id": number,"relationship": string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"token_id"?: number | null
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"family_scope"?: boolean,"id"?: never,"linked_by"?: string | null,"member_id"?: number,"relationship"?: string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"token_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "portal_account_members_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "portal_accounts"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "portal_account_members_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "portal_account_members_token_id_fkey"
      columns: ["token_id"]
isOneToOne: false
      referencedRelation: "portal_access_tokens"
      referencedColumns: ["id"]
    }
                  ]
                },"portal_accounts": {
                  Row: {
                    "blocked_at": string | null,"blocked_by": string | null,"blocked_reason": string | null,"created_at": string,"dni": string,"email_verified_at": string | null,"first_name": string,"last_name": string,"password_set_at": string | null,"phone_e164": string | null,"status": string,"terms_accepted_at": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "blocked_at"?: string | null,"blocked_by"?: string | null,"blocked_reason"?: string | null,"created_at"?: string,"dni": string,"email_verified_at"?: string | null,"first_name": string,"last_name": string,"password_set_at"?: string | null,"phone_e164"?: string | null,"status"?: string,"terms_accepted_at": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "blocked_at"?: string | null,"blocked_by"?: string | null,"blocked_reason"?: string | null,"created_at"?: string,"dni"?: string,"email_verified_at"?: string | null,"first_name"?: string,"last_name"?: string,"password_set_at"?: string | null,"phone_e164"?: string | null,"status"?: string,"terms_accepted_at"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"settings": {
                  Row: {
                    "billing_start_period": string | null,"club_name": string,"default_phone_area_code": string | null,"id": number,"updated_at": string
                  }
                  Insert: {
                    "billing_start_period"?: string | null,"club_name"?: string,"default_phone_area_code"?: string | null,"id"?: number,"updated_at"?: string
                  }
                  Update: {
                    "billing_start_period"?: string | null,"club_name"?: string,"default_phone_area_code"?: string | null,"id"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sponsors": {
                  Row: {
                    "contact_name": string | null,"created_at": string,"created_by": string | null,"deactivated_at": string | null,"deactivated_by": string | null,"deactivation_reason": string | null,"email": string | null,"id": number,"is_active": boolean,"name": string,"notes": string | null,"phone": string | null,"updated_at": string
                  }
                  Insert: {
                    "contact_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_reason"?: string | null,"email"?: string | null,"id"?: never,"is_active"?: boolean,"name": string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "contact_name"?: string | null,"created_at"?: string,"created_by"?: string | null,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"deactivation_reason"?: string | null,"email"?: string | null,"id"?: never,"is_active"?: boolean,"name"?: string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "fee_status": {
                  Row: {
                    "amount_cents": number | null,"category_id": number | null,"discipline_id": number | null,"fee_id": number | null,"kind": string | null,"member_id": number | null,"paid_cents": number | null,"pending_cents": number | null,"period": string | null,"status": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fees_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_discipline_id_fkey"
      columns: ["discipline_id"]
isOneToOne: false
      referencedRelation: "disciplines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fees_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_credit": {
                  Row: {
                    "allocated_cents": number | null,"amount_cents": number | null,"credit_cents": number | null,"member_id": number | null,"paid_on": string | null,"payment_id": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "cash_month_summary":
{ Args: { "target_period"?: string }; Returns: {
              "by_concept": Json,"cash_cents": number,"fees_cents": number,"fees_collected_cents": number,"fees_count": number,"other_income_cents": number,"other_income_count": number,"payments_count": number,"period": string,"total_cents": number,"transfer_cents": number
            }[]
                           },
"confirm_password_changed":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"correct_member_joined_on":
{ Args: { "new_joined_on": string,"target_member_id": number }; Returns: undefined
                           },
"create_portal_token":
{ Args: { "p_account_id"?: string,"p_delivery": string,"p_family_scope"?: boolean,"p_member_id"?: number,"p_purpose": string,"p_relationship"?: string,"p_replace_pending"?: boolean,"p_request_id"?: number }; Returns: {
              "expires_at": string,"token": string,"token_id": number
            }[]
                           },
"daily_collection":
{ Args: { "target_period"?: string }; Returns: {
              "collected_cents": number,"cumulative_cents": number,"day": string
            }[]
                           },
"dashboard_summary":
{ Args: Record<PropertyKey, never>; Returns: {
              "active_members": number,"admissions_count": number,"billing_active": boolean,"billing_start_period": string,"cash_cents": number,"collected_cents": number,"credit_cents": number,"expired_clearances": number,"fees_cents": number,"fees_count": number,"inactive_debt_cents": number,"inactive_in_debt": number,"members_in_debt": number,"members_with_credit": number,"missing_clearances": number,"payments_count": number,"pending_periods": (string)[],"period": string,"reactivations_count": number,"total_debt_cents": number,"transfer_cents": number,"withdrawals_count": number
            }[]
                           },
"debt_by_category":
{ Args: Record<PropertyKey, never>; Returns: {
              "category_id": number,"category_name": string,"debt_cents": number,"discipline_id": number,"discipline_name": string,"kind": string,"members": number,"members_in_debt": number,"sort_order": number
            }[]
                           },
"generate_pending_fees":
{ Args: Record<PropertyKey, never>; Returns: {
              "error_message": string,"fees_created": number,"status": string
            }[]
                           },
"keep_alive":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"log_export":
{ Args: { "filters": Json,"listing": string,"row_count": number }; Returns: undefined
                           },
"mark_password_reset":
{ Args: { "target_user_id": string }; Returns: undefined
                           },
"member_accounts":
{ Args: { "category_filter"?: number,"member_ids"?: (number)[],"status_filter"?: string }; Returns: {
              "balance_cents": number,"categories": Json,"charged_cents": number,"current_fee_cents": number,"current_fee_period": string,"current_fees": Json,"debt_status": string,"family_group_id": number,"full_name": string,"is_payment_responsible": boolean,"last_payment_cents": number,"last_payment_on": string,"member_id": number,"member_type": string,"months_due": number,"oldest_due_period": string,"paid_cents": number,"status": string
            }[]
                           },
"member_balance_cents":
{ Args: { "m": Database["public"]['Tables']["members"]['Row'] }; Returns: number
                           },
"member_debt_status":
{ Args: { "m": Database["public"]['Tables']["members"]['Row'] }; Returns: string
                           },
"member_fee_statement":
{ Args: { "target_member_id": number }; Returns: {
              "amount_cents": number,"category_id": number,"covered_cents": number,"description": string,"discipline_id": number,"fee_id": number,"kind": string,"period": string,"status": string,"void_reason": string,"voided_at": string
            }[]
                           },
"member_months_due":
{ Args: { "m": Database["public"]['Tables']["members"]['Row'] }; Returns: number
                           },
"month_collection":
{ Args: { "target_period"?: string }; Returns: {
              "cash_cents": number,"collected_cents": number,"fees_cents": number,"fees_count": number,"payments_count": number,"period": string,"transfer_cents": number
            }[]
                           },
"monthly_history":
{ Args: { "months"?: number }; Returns: {
              "collected_cents": number,"debt_at_close_cents": number,"fees_cents": number,"period": string
            }[]
                           },
"my_permissions":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"payment_month_options":
{ Args: { "member_ids": (number)[] }; Returns: {
              "amount_cents": number,"before_joined": boolean,"covered_cents": number,"is_current": boolean,"kind": string,"member_id": number,"pending_cents": number,"period": string,"priced_at_today": boolean
            }[]
                           },
"portal_mark_password_set":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"portal_me":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"portal_request_candidates":
{ Args: { "p_request_id": number }; Returns: {
              "family_group_id": number,"has_account": boolean,"member_id": number,"person_id": number,"reasons": (string)[],"score": number
            }[]
                           },
"portal_submit_access_request":
{ Args: { "p_client_key": string,"p_dni": string,"p_email": string,"p_first_name": string,"p_last_name": string,"p_message": string,"p_people": Json,"p_phone_e164": string,"p_phone_raw": string }; Returns: boolean
                           },
"portal_token_consume":
{ Args: { "p_check_dni"?: string,"p_first_name"?: string,"p_last_name"?: string,"p_person_dni"?: string,"p_phone_e164"?: string,"p_terms_accepted"?: boolean,"p_token": string,"p_user_id": string }; Returns: {
              "account_id": string,"status": string
            }[]
                           },
"portal_token_peek":
{ Args: { "p_dni"?: string,"p_token": string }; Returns: {
              "account_id": string,"family_scope": boolean,"purpose": string,"status": string,"token_id": number
            }[]
                           },
"register_payment_batch":
{ Args: { "batch_id": string,"items": Json,"method": string,"notes": string,"paid_on": string,"receipt_storage_path": string }; Returns: {
              "already_registered": boolean,"amount_cents": number,"member_id": number,"opening_balance_fee_id": number,"payment_id": number
            }[]
                           },
"resolve_portal_request":
{ Args: { "p_note": string,"p_request_id": number,"p_status": string }; Returns: undefined
                           },
"revoke_portal_link":
{ Args: { "p_link_id": number,"p_reason": string }; Returns: undefined
                           },
"revoke_portal_token":
{ Args: { "p_reason": string,"p_token_id": number }; Returns: undefined
                           },
"set_family_payment_responsible":
{ Args: { "group_id": number,"member_id": number }; Returns: undefined
                           },
"set_member_categories":
{ Args: { "category_ids": (number)[],"effective_on"?: string,"target_member_id": number }; Returns: undefined
                           },
"set_portal_account_status":
{ Args: { "p_reason": string,"p_status": string,"p_user_id": string }; Returns: undefined
                           },
"sponsor_summaries":
{ Args: { "target_sponsor_id"?: number,"target_year"?: number }; Returns: {
              "all_time_total_cents": number,"contact_name": string,"contributions_count": number,"deactivated_at": string,"deactivation_reason": string,"email": string,"is_active": boolean,"last_contribution_cents": number,"last_contribution_on": string,"name": string,"notes": string,"phone": string,"sponsor_id": number,"year_total_cents": number
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

