export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          details: Json | null
          id: string
          order_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          expiry_minutes: number
          id: number
          max_usd: number
          min_usd: number
          notify_min_usd_created: number
          paused: boolean
          paused_reason: string | null
          premium_bps: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          expiry_minutes?: number
          id?: number
          max_usd?: number
          min_usd?: number
          notify_min_usd_created?: number
          paused?: boolean
          paused_reason?: string | null
          premium_bps?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          expiry_minutes?: number
          id?: number
          max_usd?: number
          min_usd?: number
          notify_min_usd_created?: number
          paused?: boolean
          paused_reason?: string | null
          premium_bps?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      deposits: {
        Row: {
          amount_usd: number
          block_number: number
          chain: string
          confirmations: number
          detected_at: string
          from_address: string
          id: string
          log_index: number
          order_id: string | null
          to_address: string
          token: string
          tx_hash: string
        }
        Insert: {
          amount_usd: number
          block_number: number
          chain: string
          confirmations?: number
          detected_at?: string
          from_address: string
          id?: string
          log_index?: number
          order_id?: string | null
          to_address: string
          token: string
          tx_hash: string
        }
        Update: {
          amount_usd?: number
          block_number?: number
          chain?: string
          confirmations?: number
          detected_at?: string
          from_address?: string
          id?: string
          log_index?: number
          order_id?: string | null
          to_address?: string
          token?: string
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      hd_address_counter: {
        Row: {
          id: number
          next_index: number
          updated_at: string
        }
        Insert: {
          id?: number
          next_index?: number
          updated_at?: string
        }
        Update: {
          id?: number
          next_index?: number
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          bitmart_avg_price: number | null
          bitmart_filled_txc: number | null
          bitmart_order_id: string | null
          bitmart_spot_price: number
          created_at: string
          deposit_address: string
          deposit_index: number
          dest_asset: string
          dest_txc_address: string
          error_message: string | null
          expires_at: string
          id: string
          paid_amount_usd: number | null
          paid_tx_hash: string | null
          premium_bps: number
          public_id: string
          quoted_txc_out: number
          quoted_txc_per_usd: number
          source_amount_usd: number
          source_chain: string
          source_token: string
          status: Database["public"]["Enums"]["order_status"]
          txc_tx_hash: string | null
          updated_at: string
          withdrawal_id: string | null
        }
        Insert: {
          bitmart_avg_price?: number | null
          bitmart_filled_txc?: number | null
          bitmart_order_id?: string | null
          bitmart_spot_price: number
          created_at?: string
          deposit_address: string
          deposit_index: number
          dest_asset?: string
          dest_txc_address: string
          error_message?: string | null
          expires_at?: string
          id?: string
          paid_amount_usd?: number | null
          paid_tx_hash?: string | null
          premium_bps?: number
          public_id?: string
          quoted_txc_out: number
          quoted_txc_per_usd: number
          source_amount_usd: number
          source_chain: string
          source_token: string
          status?: Database["public"]["Enums"]["order_status"]
          txc_tx_hash?: string | null
          updated_at?: string
          withdrawal_id?: string | null
        }
        Update: {
          bitmart_avg_price?: number | null
          bitmart_filled_txc?: number | null
          bitmart_order_id?: string | null
          bitmart_spot_price?: number
          created_at?: string
          deposit_address?: string
          deposit_index?: number
          dest_asset?: string
          dest_txc_address?: string
          error_message?: string | null
          expires_at?: string
          id?: string
          paid_amount_usd?: number | null
          paid_tx_hash?: string | null
          premium_bps?: number
          public_id?: string
          quoted_txc_out?: number
          quoted_txc_per_usd?: number
          source_amount_usd?: number
          source_chain?: string
          source_token?: string
          status?: Database["public"]["Enums"]["order_status"]
          txc_tx_hash?: string | null
          updated_at?: string
          withdrawal_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_hd_index: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin"
      order_status:
        | "awaiting_payment"
        | "payment_detected"
        | "confirmed"
        | "buying_on_bitmart"
        | "bought"
        | "withdrawing"
        | "completed"
        | "expired"
        | "failed"
        | "refunded"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
      order_status: [
        "awaiting_payment",
        "payment_detected",
        "confirmed",
        "buying_on_bitmart",
        "bought",
        "withdrawing",
        "completed",
        "expired",
        "failed",
        "refunded",
      ],
    },
  },
} as const
