package com.watchtogether.backend.room;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.Cookie;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.api.ApiExceptionHandler;
import com.watchtogether.backend.api.CorrelationIdFilter;
import com.watchtogether.backend.config.SecurityConfig;
import com.watchtogether.backend.room.CreateRoomResponse.Participant;
import com.watchtogether.backend.room.CreateRoomResponse.RoomSnapshot;
import com.watchtogether.backend.room.RoomJoinService.JoinResponse;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(RoomController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, CorrelationIdFilter.class})
class RoomJoinControllerTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String SESSION = "A".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID GUEST_ID =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private RoomCreationService roomCreationService;

    @MockitoBean
    private RoomRestoreService roomRestoreService;

    @MockitoBean
    private RoomJoinService roomJoinService;

    @MockitoBean
    private RoomCloseService roomCloseService;

    @MockitoBean
    private RoomLeaveService roomLeaveService;

    @MockitoBean
    private LiveKitTokenService liveKitTokenService;

    @MockitoBean
    private RoomProperties roomProperties;

    @BeforeEach
    void setUp() {
        when(roomProperties.sessionCookieSecure()).thenReturn(false);
    }

    @Test
    void joinsRoomAccordingToContract() throws Exception {
        when(roomJoinService.join(ROOM_ID, "Guest", null)).thenReturn(joinResponse());

        mockMvc.perform(post("/api/v1/rooms/{roomId}/join", ROOM_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Guest"}
                                """))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("HttpOnly")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, containsString("SameSite=Strict")))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, not(containsString("Secure"))))
                .andExpect(cookie().value("wt_session", SESSION))
                .andExpect(jsonPath("$.participant.participantId").value(GUEST_ID.toString()))
                .andExpect(jsonPath("$.participant.role").value("GUEST"))
                .andExpect(jsonPath("$.room.roomId").value(ROOM_ID))
                .andExpect(jsonPath("$.room.participants.length()").value(2))
                .andExpect(jsonPath("$.room.roomVersion").value(1));
    }

    @Test
    void passesExistingSessionCookieForRepeatedJoin() throws Exception {
        when(roomJoinService.join(ROOM_ID, "Guest", SESSION)).thenReturn(joinResponse());

        mockMvc.perform(post("/api/v1/rooms/{roomId}/join", ROOM_ID)
                        .cookie(new Cookie("wt_session", SESSION))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Guest"}
                                """))
                .andExpect(status().isOk());

        verify(roomJoinService).join(ROOM_ID, "Guest", SESSION);
    }

    @Test
    void returnsValidationProblemForBlankGuestName() throws Exception {
        mockMvc.perform(post("/api/v1/rooms/{roomId}/join", ROOM_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"   "}
                                """))
                .andExpect(status().isUnprocessableContent())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.violations[0].field").value("displayName"));
    }

    @Test
    void returnsGenericUnavailableProblemForMissingRoom() throws Exception {
        when(roomJoinService.join(ROOM_ID, "Guest", null))
                .thenThrow(new ApiException(
                        HttpStatus.NOT_FOUND,
                        "ROOM_UNAVAILABLE",
                        "Комната недоступна",
                        "Комната не найдена, закрыта или срок её действия истёк.",
                        false,
                        List.of()));

        mockMvc.perform(post("/api/v1/rooms/{roomId}/join", ROOM_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Guest"}
                                """))
                .andExpect(status().isNotFound())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("ROOM_UNAVAILABLE"))
                .andExpect(jsonPath("$.retryable").value(false));
    }

    private JoinResponse joinResponse() {
        Instant now = Instant.parse("2026-07-09T09:00:00Z");
        Participant host =
                new Participant(HOST_ID, "Host", ParticipantRole.HOST, true, now.minusSeconds(60));
        Participant guest = new Participant(GUEST_ID, "Guest", ParticipantRole.GUEST, true, now);
        RoomSnapshot room = new RoomSnapshot(
                ROOM_ID,
                RoomStatus.CREATED,
                HOST_ID,
                List.of(host, guest),
                null,
                1,
                now.plus(Duration.ofHours(3)),
                now);
        return new JoinResponse(
                new JoinRoomResponse(guest, room), SESSION, Duration.ofHours(3));
    }
}
